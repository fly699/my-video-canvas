import type { Express, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * 内置「局域网大文件中转站」——把本应用当作内网里机器对机器搬运几十 GB 大文件的
 * HTTP 中转：任意机器用 curl / 浏览器把文件流式 PUT 进来，别的机器再流式取走
 * （支持 Range 断点续传）。文件落在服务器本地磁盘的中转目录（RELAY_DIR 可配）。
 *
 * 设计取舍（按用户确认）：局域网内默认不鉴权；如需收紧，设环境变量 RELAY_TOKEN
 * 后所有接口要求带该令牌（?token= 或 X-Relay-Token 头）。
 *
 * 路由（全部在 express.json 之前注册，保证 PUT 的原始字节流不被 body 解析器吞掉）：
 *   GET    /relay                       管理页（自包含 HTML）
 *   GET    /relay/api/list              列出中转文件
 *   PUT    /relay/api/upload/:name      流式上传（覆盖同名）
 *   GET    /relay/api/download/:name    流式下载（支持 Range 续传）
 *   DELETE /relay/api/delete/:name      删除
 */

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024 * 1024; // 500GB 防失控上限（非内存占用）

export function relayDir(): string {
  return process.env.RELAY_DIR?.trim() || path.join(process.cwd(), ".relay-files");
}

function relayMaxBytes(): number {
  const v = Number(process.env.RELAY_MAX_BYTES);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_BYTES;
}

function ensureDir(): string {
  const dir = relayDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 把外部传入的文件名收敛为安全的纯文件名（去目录、拒绝穿越）；非法返回 null。 */
export function safeName(raw: string): string | null {
  const n = path.basename(String(raw ?? "").trim());
  if (!n || n === "." || n === ".." || n.includes("/") || n.includes("\\") || n.includes("\0")) return null;
  if (n.length > 255) return null;
  return n;
}

/** 解析 Range 头。返回 {start,end} | "invalid"（416）| null（无 Range，整文件）。 */
export function parseRange(rangeHeader: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return "invalid";
  const hasS = m[1] !== "";
  const hasE = m[2] !== "";
  if (!hasS && !hasE) return "invalid";
  let start: number;
  let end: number;
  if (!hasS) {
    // 后缀范围：最后 N 字节
    const suffix = parseInt(m[2], 10);
    if (suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = hasE ? parseInt(m[2], 10) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (end > size - 1) end = size - 1;
  if (start > end || start < 0) return "invalid";
  return { start, end };
}

const MIME: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", "7z": "application/x-7z-compressed",
  pdf: "application/pdf", json: "application/json", txt: "text/plain; charset=utf-8",
};
function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

function checkToken(req: Request, res: Response): boolean {
  const tok = process.env.RELAY_TOKEN?.trim();
  if (!tok) return true; // 默认：局域网内不鉴权
  const got = (typeof req.query.token === "string" ? req.query.token : "") || String(req.headers["x-relay-token"] ?? "");
  if (got === tok) return true;
  res.status(403).json({ error: "无效的中转令牌（需带 ?token= 或 X-Relay-Token）" });
  return false;
}

export function registerFileRelay(app: Express): void {
  // ── 管理页 ──
  app.get("/relay", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(RELAY_HTML);
  });

  // ── 列表 ──
  app.get("/relay/api/list", (req, res) => {
    if (!checkToken(req, res)) return;
    const dir = ensureDir();
    fs.readdir(dir, (err, names) => {
      if (err) { res.json({ files: [] }); return; }
      const files = names
        .filter((n) => !n.endsWith(".part"))
        .map((n) => {
          try {
            const st = fs.statSync(path.join(dir, n));
            return st.isFile() ? { name: n, size: st.size, mtime: st.mtimeMs } : null;
          } catch { return null; }
        })
        .filter((x): x is { name: string; size: number; mtime: number } => x !== null)
        .sort((a, b) => b.mtime - a.mtime);
      res.json({ files });
    });
  });

  // ── 流式上传（覆盖同名）──
  app.put("/relay/api/upload/:name", (req, res) => {
    if (!checkToken(req, res)) return;
    const name = safeName(req.params.name);
    if (!name) { res.status(400).json({ error: "非法文件名" }); return; }
    const dir = ensureDir();
    const finalPath = path.join(dir, name);
    const tmpPath = `${finalPath}.${Date.now()}.part`;
    const max = relayMaxBytes();
    const ws = fs.createWriteStream(tmpPath);
    let bytes = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > max) { aborted = true; req.destroy(); ws.destroy(); }
    });
    void pipeline(req, ws)
      .then(() => {
        fs.renameSync(tmpPath, finalPath);
        res.json({ ok: true, name, size: bytes, download: `/relay/api/download/${encodeURIComponent(name)}` });
      })
      .catch((err: unknown) => {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        if (res.headersSent) return;
        if (aborted) res.status(413).json({ error: `文件超过上限（${max} 字节）` });
        else res.status(500).json({ error: "写入失败：" + (err instanceof Error ? err.message : String(err)) });
      });
  });

  // ── 流式下载（支持 Range 续传）──
  app.get("/relay/api/download/:name", (req, res) => {
    if (!checkToken(req, res)) return;
    const name = safeName(req.params.name);
    if (!name) { res.status(400).json({ error: "非法文件名" }); return; }
    const full = path.join(relayDir(), name);
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) { res.status(404).json({ error: "文件不存在" }); return; }
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", mimeFromName(name));
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      const range = parseRange(req.headers.range, st.size);
      if (range === "invalid") {
        res.status(416).setHeader("Content-Range", `bytes */${st.size}`);
        res.end();
        return;
      }
      if (range) {
        res.status(206);
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${st.size}`);
        res.setHeader("Content-Length", String(range.end - range.start + 1));
        fs.createReadStream(full, { start: range.start, end: range.end }).pipe(res);
      } else {
        res.setHeader("Content-Length", String(st.size));
        fs.createReadStream(full).pipe(res);
      }
    });
  });

  // ── 删除 ──
  app.delete("/relay/api/delete/:name", (req, res) => {
    if (!checkToken(req, res)) return;
    const name = safeName(req.params.name);
    if (!name) { res.status(400).json({ error: "非法文件名" }); return; }
    fs.unlink(path.join(relayDir(), name), (err) => {
      if (err) { res.status(404).json({ error: "删除失败或文件不存在" }); return; }
      res.json({ ok: true });
    });
  });
}

// ── 自包含管理页（无 React 耦合，直接由后端返回） ──
const RELAY_HTML = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>局域网文件中转</title>
<style>
  :root { color-scheme: dark; --acc:#6f7bff; --bg:#0d0e12; --card:#15171e; --bd:#23262f; --t1:#e8e9ec; --t2:#a3a6b0; --t3:#73767f; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--t1);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 34px 20px 64px; }
  .head { display:flex; align-items:center; gap:12px; margin-bottom:4px; }
  .logo { width:38px; height:38px; border-radius:11px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg,#6f7bff,#9a6bff); box-shadow:0 4px 14px rgba(111,123,255,.35); }
  h1 { font-size: 19px; margin: 0; letter-spacing:.2px; }
  .sub { color:var(--t2); font-size: 13px; margin: 6px 0 22px; line-height:1.6; }
  .drop { position:relative; border:1.5px dashed #30343f; border-radius:16px; padding:34px 20px; text-align:center;
    color:var(--t2); cursor:pointer; transition:.16s; background:var(--card); }
  .drop:hover { border-color:#3c4150; background:#181b22; }
  .drop.over { border-color:var(--acc); background:#181c2a; color:#cfd3ff; box-shadow:0 0 0 4px rgba(111,123,255,.12) inset; }
  .drop .big { font-size:14px; color:var(--t1); margin-bottom:4px; }
  .drop .big b { color:var(--acc); }
  .drop .hint { font-size:12px; color:var(--t3); }
  .bar { height:6px; background:#23262f; border-radius:99px; overflow:hidden; margin-top:12px; display:none; }
  .bar > i { display:block; height:100%; width:0; border-radius:99px; background:linear-gradient(90deg,#6f7bff,#9a6bff); transition:width .12s; }
  #status { margin-top:9px; font-size:12px; color:var(--t2); min-height:16px; }
  .listhead { display:flex; align-items:center; justify-content:space-between; margin:26px 2px 10px; }
  .listhead .lbl { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--t3); }
  .listhead .cnt { font-size:12px; color:var(--t3); }
  .row { display:flex; align-items:center; gap:13px; padding:11px 13px; border:1px solid var(--bd); border-radius:13px;
    background:var(--card); margin-bottom:9px; transition:.14s; }
  .row:hover { border-color:#33384a; background:#171a22; }
  .ic { width:42px; height:42px; border-radius:10px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
    background:#1c1f2a; color:#8ea0ff; font-size:10.5px; font-weight:800; letter-spacing:.02em; }
  .meta { min-width:0; flex:1; }
  .fn { font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .submeta { font-size:11.5px; color:var(--t3); margin-top:3px; }
  .submeta b { color:var(--t2); font-weight:600; }
  .acts { display:flex; gap:7px; flex-shrink:0; }
  .btn { display:inline-flex; align-items:center; padding:6px 12px; border-radius:9px; font-size:12px; font-weight:600;
    cursor:pointer; border:1px solid var(--bd); background:#1a1d26; color:#cfd3ff; text-decoration:none; transition:.13s; }
  .btn:hover { border-color:#3c4150; background:#20242f; }
  .btn.dl { color:#bfc6ff; }
  .btn.del { color:#ff9b9b; }
  .btn.del:hover { border-color:#5a2c34; background:#2a1a1e; }
  .empty { text-align:center; color:var(--t3); padding:34px; border:1px dashed var(--bd); border-radius:13px; font-size:13px; }
  .cli { margin-top:30px; background:#0a0b0f; border:1px solid var(--bd); border-radius:13px; padding:16px 16px 8px; }
  .cli .ttl { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--t3); margin-bottom:12px; }
  .cmd { display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid #15171d; }
  .cmd:first-of-type { border-top:none; }
  .cmd .k { font-size:11.5px; color:var(--t3); width:64px; flex-shrink:0; }
  .cmd code { flex:1; min-width:0; font-size:12px; color:#9cdcfe; overflow-x:auto; white-space:nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .copy { flex-shrink:0; padding:4px 9px; border-radius:7px; font-size:11px; cursor:pointer; border:1px solid var(--bd);
    background:#1a1d26; color:var(--t2); }
  .copy:hover { color:var(--t1); border-color:#3c4150; }
</style></head>
<body><div class="wrap">
  <div class="head">
    <div class="logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
    <h1>局域网文件中转</h1>
  </div>
  <div class="sub">把大文件拖到下面上传，内网其它机器即可下载。支持断点续传（Range），适合几十 GB 大文件。</div>
  <div id="drop" class="drop">
    <div class="big"><b>点击选择</b> 或把文件拖到这里</div>
    <div class="hint">支持多文件 · 流式直传，不限大小</div>
    <input id="file" type="file" multiple style="display:none">
  </div>
  <div class="bar" id="bar"><i id="barfill"></i></div>
  <div id="status"></div>
  <div class="listhead"><span class="lbl">中转文件</span><span class="cnt" id="cnt"></span></div>
  <div id="list"></div>
  <div id="empty" class="empty" style="display:none">暂无文件，先上传一个吧</div>
  <div class="cli">
    <div class="ttl">命令行（其它机器）</div>
    <div class="cmd"><span class="k">上传</span><code id="cup"></code><button class="copy" data-t="cup">复制</button></div>
    <div class="cmd"><span class="k">下载</span><code id="cdown"></code><button class="copy" data-t="cdown">复制</button></div>
    <div class="cmd"><span class="k">续传下载</span><code id="cresume"></code><button class="copy" data-t="cresume">复制</button></div>
  </div>
</div>
<script>
const origin = location.origin;
const cmds = {
  cup: 'curl -T ./bigfile.mov ' + origin + '/relay/api/upload/bigfile.mov',
  cdown: 'curl -O ' + origin + '/relay/api/download/bigfile.mov',
  cresume: 'curl -C - -O ' + origin + '/relay/api/download/bigfile.mov',
};
for (const k in cmds) document.getElementById(k).textContent = cmds[k];
document.querySelectorAll('.copy').forEach(b => b.onclick = async () => {
  try { await navigator.clipboard.writeText(cmds[b.dataset.t]); const o=b.textContent; b.textContent='已复制'; setTimeout(()=>b.textContent=o,1200); } catch {}
});
function human(n){ if(n<1024)return n+' B'; const u=['KB','MB','GB','TB']; let i=-1; do{n/=1024;i++;}while(n>=1024&&i<u.length-1); return n.toFixed(n<10?2:1)+' '+u[i]; }
function fmt(ms){ const d=new Date(ms); const p=x=>String(x).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
function ext(n){ const i=n.lastIndexOf('.'); const e=i>=0? n.slice(i+1):''; return (e||'file').slice(0,4).toUpperCase(); }
function esc(s){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function refresh(){
  let j={files:[]}; try{ j = await (await fetch('/relay/api/list')).json(); }catch{}
  const box = document.getElementById('list'); box.innerHTML='';
  document.getElementById('empty').style.display = j.files.length? 'none':'block';
  document.getElementById('cnt').textContent = j.files.length? (j.files.length+' 个文件'):'';
  for(const f of j.files){
    const dl='/relay/api/download/'+encodeURIComponent(f.name);
    const row=document.createElement('div'); row.className='row';
    row.innerHTML='<div class="ic">'+esc(ext(f.name))+'</div>'+
      '<div class="meta"><div class="fn" title="'+esc(f.name)+'">'+esc(f.name)+'</div>'+
      '<div class="submeta"><b>'+human(f.size)+'</b> · '+fmt(f.mtime)+'</div></div>'+
      '<div class="acts"><a class="btn dl" href="'+dl+'">下载</a>'+
      '<button class="btn del" data-n="'+esc(f.name)+'">删除</button></div>';
    box.appendChild(row);
  }
  box.querySelectorAll('button.del').forEach(b=>b.onclick=async()=>{
    if(!confirm('删除 '+b.dataset.n+' ?'))return;
    await fetch('/relay/api/delete/'+encodeURIComponent(b.dataset.n),{method:'DELETE'}); refresh();
  });
}
const drop=document.getElementById('drop'), fileInput=document.getElementById('file');
const bar=document.getElementById('bar'), fill=document.getElementById('barfill'), statusEl=document.getElementById('status');
drop.onclick=()=>fileInput.click();
fileInput.onchange=()=>{ uploadAll([...fileInput.files]); fileInput.value=''; };
['dragenter','dragover'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',ev=>{ uploadAll([...ev.dataTransfer.files]); });
async function uploadAll(files){ for(const f of files){ await uploadOne(f); } refresh(); }
function uploadOne(file){ return new Promise(res=>{
  const xhr=new XMLHttpRequest();
  xhr.open('PUT','/relay/api/upload/'+encodeURIComponent(file.name));
  bar.style.display='block';
  xhr.upload.onprogress=e=>{ if(e.lengthComputable){ const p=e.loaded/e.total*100; fill.style.width=p+'%';
    statusEl.textContent='上传 '+file.name+'  '+human(e.loaded)+' / '+human(e.total)+'  ('+p.toFixed(1)+'%)'; } };
  xhr.onload=()=>{ fill.style.width='0'; bar.style.display='none';
    statusEl.textContent = xhr.status<300? ('✓ 已上传 '+file.name) : ('✗ 上传失败：'+file.name+' '+xhr.responseText); res(); };
  xhr.onerror=()=>{ bar.style.display='none'; statusEl.textContent='✗ 上传出错：'+file.name; res(); };
  xhr.send(file);
}); }
refresh();
</script>
</body></html>`;
