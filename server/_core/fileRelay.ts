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
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    background:#0e0f13; color:#e6e7ea; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color:#8a8d96; font-size: 13px; margin-bottom: 20px; }
  .drop { border:2px dashed #2c3040; border-radius:14px; padding:28px; text-align:center; color:#9aa; cursor:pointer;
    transition: all .15s; background:#14161c; }
  .drop.over { border-color:#6f7bff; background:#181b27; color:#cfd3ff; }
  .drop b { color:#cfd3ff; }
  table { width:100%; border-collapse:collapse; margin-top:22px; font-size:13px; }
  th,td { text-align:left; padding:9px 10px; border-bottom:1px solid #1d2029; }
  th { color:#8a8d96; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
  td.name { word-break:break-all; }
  a.btn, button.btn { display:inline-block; padding:5px 10px; border-radius:8px; font-size:12px; cursor:pointer;
    border:1px solid #2c3040; background:#171a22; color:#cfd3ff; text-decoration:none; }
  button.btn.del { color:#ff9b9b; border-color:#3a2730; }
  .bar { height:6px; background:#1d2029; border-radius:4px; overflow:hidden; margin-top:8px; display:none; }
  .bar > i { display:block; height:100%; width:0; background:#6f7bff; transition: width .1s; }
  .muted { color:#8a8d96; }
  .curl { margin-top:26px; background:#0b0c10; border:1px solid #1d2029; border-radius:10px; padding:14px 16px; font-size:12px; }
  .curl code { color:#9cdcfe; }
  .empty { text-align:center; color:#6a6d76; padding:26px; }
</style></head>
<body><div class="wrap">
  <h1>局域网文件中转</h1>
  <div class="sub">把大文件拖到下面上传，内网其它机器即可下载。支持断点续传（Range）。</div>
  <div id="drop" class="drop"><b>点击选择</b> 或把文件拖到这里上传<input id="file" type="file" multiple style="display:none"></div>
  <div class="bar" id="bar"><i id="barfill"></i></div>
  <div id="status" class="muted" style="margin-top:8px;font-size:12px"></div>
  <table><thead><tr><th>文件名</th><th style="width:120px">大小</th><th style="width:170px">修改时间</th><th style="width:150px">操作</th></tr></thead>
  <tbody id="list"></tbody></table>
  <div id="empty" class="empty" style="display:none">暂无文件</div>
  <div class="curl">
    <div style="margin-bottom:6px;color:#8a8d96">命令行（其它机器）：</div>
    上传：<code id="cup">curl -T ./bigfile.mov ORIGIN/relay/api/upload/bigfile.mov</code><br>
    下载：<code id="cdown">curl -O ORIGIN/relay/api/download/bigfile.mov</code><br>
    续传下载：<code>curl -C - -O ORIGIN/relay/api/download/bigfile.mov</code>
  </div>
</div>
<script>
const origin = location.origin;
document.getElementById('cup').textContent = 'curl -T ./bigfile.mov ' + origin + '/relay/api/upload/bigfile.mov';
document.getElementById('cdown').textContent = 'curl -O ' + origin + '/relay/api/download/bigfile.mov';
function human(n){ if(n<1024)return n+' B'; const u=['KB','MB','GB','TB']; let i=-1; do{n/=1024;i++;}while(n>=1024&&i<u.length-1); return n.toFixed(n<10?2:1)+' '+u[i]; }
function fmt(ms){ const d=new Date(ms); const p=x=>String(x).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
async function refresh(){
  const r = await fetch('/relay/api/list'); const j = await r.json();
  const tb = document.getElementById('list'); tb.innerHTML='';
  document.getElementById('empty').style.display = j.files.length? 'none':'block';
  for(const f of j.files){
    const tr=document.createElement('tr');
    const dl='/relay/api/download/'+encodeURIComponent(f.name);
    tr.innerHTML='<td class="name">'+esc(f.name)+'</td><td>'+human(f.size)+'</td><td>'+fmt(f.mtime)+'</td>'+
      '<td><a class="btn" href="'+dl+'">下载</a> <button class="btn del" data-n="'+esc(f.name)+'">删除</button></td>';
    tb.appendChild(tr);
  }
  tb.querySelectorAll('button.del').forEach(b=>b.onclick=async()=>{
    if(!confirm('删除 '+b.dataset.n+' ?'))return;
    await fetch('/relay/api/delete/'+encodeURIComponent(b.dataset.n),{method:'DELETE'}); refresh();
  });
}
function esc(s){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
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
    statusEl.textContent = xhr.status<300? ('已上传 '+file.name) : ('上传失败：'+file.name+' '+xhr.responseText); res(); };
  xhr.onerror=()=>{ bar.style.display='none'; statusEl.textContent='上传出错：'+file.name; res(); };
  xhr.send(file);
}); }
refresh();
</script>
</body></html>`;
