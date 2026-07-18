/**
 * #238 文件暂存·二进制直传路由（管理后台「文件暂存」面板专用）。
 *
 * 为什么不走 tRPC：tRPC 请求体是 JSON，文件须 base64 编码（体积 +1/3），受全局
 * express.json 50mb 限额约束，原始文件只能到 ~32MB。本路由让浏览器把文件按
 * 原生二进制 POST 上来（fetch body 直接传 File，不经 base64、不占 JSON 限额），
 * 单文件上限对齐两家服务商的 100MB。
 *
 * 【必须注册在 express.json 之前】否则 body 流被 JSON 中间件消费。
 *
 * 鉴权与门控（与 tRPC 版同口径，手动强制——本路由不在 admin.* 命名空间，
 * enforceAdminMatrix 覆盖不到，绝不能只靠前端隐藏）：
 *  1. resolveRequestUser：登录 + 冻结/待审批 gate；
 *  2. role === "admin"；
 *  3. adminLevel ≥ max(静态地板 L2 运营, 权限矩阵 staging 页 operate)；
 *  4. 每次上传写审计日志（poyo_stage / kie_stage，manual 标记）。
 */
import type { Express } from "express";
import { resolveRequestUser } from "./context";
import { getTabAccess } from "./adminPerms";
import { ENV } from "./env";
import { uploadStreamToPoyo } from "./poyoUpload";
import { uploadStreamToKie } from "./kieUpload";
import { writeAuditLog } from "./auditLog";

const MAX_BYTES = 100 * 1024 * 1024; // 两家服务商一致的 100MB 上限
const STATIC_FLOOR = 2; // 静态地板：L2 运营（与原 tRPC 版 operatorProc 一致，矩阵只能收紧）

export function registerStagingUploadRoute(app: Express) {
  app.post("/api/admin/staging-upload", (req, res) => {
    void (async () => {
      try {
        const user = await resolveRequestUser(req);
        if (!user || user.role !== "admin") { res.status(403).json({ error: "仅管理员可用" }); return; }
        const access = await getTabAccess("staging");
        const need = Math.max(STATIC_FLOOR, access.operate);
        if ((user.adminLevel ?? 0) < need) { res.status(403).json({ error: `上传需 L${need} 及以上权限` }); return; }

        const provider = req.query.provider === "poyo" ? "poyo" : req.query.provider === "kie" ? "kie" : null;
        if (!provider) { res.status(400).json({ error: "provider 须为 poyo 或 kie" }); return; }
        if (provider === "poyo" ? !ENV.poyoApiKey : !ENV.kieApiKey) {
          res.status(400).json({ error: `${provider === "poyo" ? "Poyo" : "Kie"} Key 未配置` }); return;
        }
        const rawName = typeof req.query.fileName === "string" ? req.query.fileName : "";
        const safeName = rawName.replace(/[^\w.\-一-龥]/g, "_").slice(0, 120) || "file";
        const contentType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";

        const len = Number(req.headers["content-length"] || 0);
        if (!Number.isFinite(len) || len <= 0) { res.status(411).json({ error: "缺少 Content-Length" }); return; }
        if (len > MAX_BYTES) { res.status(413).json({ error: "单文件上限 100MB" }); return; }

        // 聚合成完整 Buffer（两家上游都以 multipart 整包转发；100MB 内存峰值可接受）。
        // 边读边计数：Content-Length 可伪造，实际字节数超限立即中断。
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of req) {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += b.byteLength;
          if (total > MAX_BYTES) { res.status(413).json({ error: "单文件上限 100MB" }); req.destroy(); return; }
          chunks.push(b);
        }
        const buf = Buffer.concat(chunks);
        if (buf.byteLength === 0) { res.status(400).json({ error: "空文件" }); return; }

        const url = provider === "poyo"
          ? await uploadStreamToPoyo(buf, safeName, contentType)
          : await uploadStreamToKie(buf, safeName, contentType);
        writeAuditLog({
          ip: req.ip ?? "unknown",
          userId: user.id, userEmail: user.email, userName: user.name,
          action: provider === "poyo" ? "poyo_stage" : "kie_stage",
          detail: { manual: true, fileName: safeName, bytes: buf.byteLength, contentType },
        });
        res.json({ ok: true, url, bytes: buf.byteLength });
      } catch (err) {
        console.error("[StagingUpload] failed:", err);
        if (!res.headersSent) res.status(400).json({ error: err instanceof Error ? err.message : "上传失败" });
      }
    })();
  });
}
