import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, levelProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { invalidateWhitelistCache } from "../_core/whitelist";
import { invalidateStorageSettingsCache } from "../_core/storageConfig";
import { invalidateModelTogglesCache } from "../_core/modelToggles";
import { reloadSelfHostedConfig } from "../_core/selfHostedLlm";
import { applyTunnelEnabled, getTunnelRuntimeStatus, reloadTunnelGate, getTunnelListenerPort } from "../_core/tunnel";
import { cloudflaredInfo, startCloudflaredDownload } from "../_core/cloudflaredBin";
import { sendTunnelUrlEmail } from "../_core/tunnelEmail";
import { storagePut, storageBackend, isStorageConfigured, storageDeleteObject } from "../storage";
import { ENV } from "../_core/env";
import { randomBytes } from "crypto";
import { getUpdateStatus, getVersionInfo, getUpdateAvailable, startUpdate, restartServer } from "../_core/selfUpdate";
import { hashPassword } from "../_core/emailAuth";
import { startBackfill, getBackfillStatus } from "../_core/assetBackfill";
import { writeAuditLog } from "../_core/auditLog";
import { adminDownloadsRouter } from "./downloads";
import { encryptKieKey, kieKeyHash, kieKeyLast4, isKieCryptoConfigured } from "../_core/kieCrypto";
import { fetchKieCredit } from "../_core/kie";

// 分级过程别名（见 levelProcedure）：
//   viewerProc(L1+)   只读看板（list/get/summary/status/version）——任意管理员
//   operatorProc(L2+) 轻运维：白名单增删、冻结用户、清日志
//   managerProc(L3+)  全运维：重置密码、系统设置、KIE 密钥、删除数据、封禁、回填
//   superProc(L4)     超管独占：管理员管理、系统更新/重启
const viewerProc = adminProcedure;
const operatorProc = levelProcedure(2);
const managerProc = levelProcedure(3);
const superProc = levelProcedure(4);

const AUDIT_ACTIONS = [
  "login_email", "login_oauth",
  "image_gen", "video_gen",
  "audio_music", "audio_dubbing",
  "subtitle_transcribe",
  "logs_cleared",
] as const;

export const adminRouter = router({
  // Download authorization: review/approve user requests, batch-grant, revoke.
  downloads: adminDownloadsRouter,
  // Cross-user media library retrieval (admin browses every user's 专有仓库).
  assets: router({
    list: adminProcedure
      .input(z.object({
        userId: z.number().optional(),
        type: z.enum(["image", "video", "audio", "other"]).optional(),
        source: z.enum(["upload", "generated", "external"]).optional(),
        model: z.string().max(128).optional(),
        projectId: z.number().optional(),
        q: z.string().max(128).optional(),
        includeDeleted: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional())
      .query(({ input }) => db.getAllAssets(input ?? {})),
    // 一键回填历史素材：扫描全部画布节点，把已在 MinIO 但未入库的图片/视频
    // 记录进素材库（幂等，按 userId+storageKey 去重）。后台异步执行，前端轮询 status。
    backfill: managerProc.mutation(() => startBackfill()),
    backfillStatus: adminProcedure.query(() => getBackfillStatus()),
    // Cross-user bulk soft-delete (admin library multi-select). Soft delete keeps
    // the MinIO object + row; only visibility is cleared. Audited.
    delete: managerProc
      .input(z.object({ ids: z.array(z.number()).min(1).max(500) }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteAssetAdmin(input.ids);
        writeAuditLog({ ctx, action: "asset_admin_delete", detail: { ids: input.ids, count: input.ids.length } });
        return { success: true, count: input.ids.length };
      }),
    // Admin-only HARD delete (彻底删除): physically remove the MinIO object(s) AND
    // the DB row(s). Irreversible — gated by adminProcedure (admins only) and
    // double-confirmed in the UI. Deletes blobs first (best-effort per file), then
    // the rows; reports how many objects were actually removed. Audited.
    hardDelete: managerProc
      .input(z.object({ ids: z.array(z.number()).min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        const rows = await db.getAssetStorageKeysByIds(input.ids);
        let objectsDeleted = 0, objectsFailed = 0;
        for (const r of rows) {
          if (!r.storageKey) continue;
          try { if (await storageDeleteObject(r.storageKey)) objectsDeleted++; else objectsFailed++; }
          catch { objectsFailed++; }
        }
        await db.hardDeleteAssetsAdmin(input.ids);
        writeAuditLog({ ctx, action: "asset_admin_hard_delete", detail: { ids: input.ids, count: input.ids.length, objectsDeleted, objectsFailed } });
        return { success: true, count: input.ids.length, objectsDeleted, objectsFailed };
      }),
  }),
  logs: router({
    list: adminProcedure
      .input(z.object({
        // 上限 1000：管理面板分页用 50，「导出」按 1000/页 循环拉取。
        limit: z.number().int().min(1).max(1000).default(50),
        offset: z.number().int().min(0).default(0),
        // "kie_gen" 伪类别：只看 kie 的生成日志（image/video/music 中 model/provider 为 kie_*）。
        action: z.enum([...AUDIT_ACTIONS, "kie_gen", "poyo_stage"]).optional(),
        user: z.string().max(320).optional(), // 用户名 / 邮箱 / ID 模糊筛选
      }))
      .query(async ({ input }) => {
        return db.getAuditLogs({ limit: input.limit, offset: input.offset, action: input.action, user: input.user });
      }),

    clear: operatorProc.mutation(async ({ ctx }) => {
      await db.clearAuditLogs();
      // Write a sentinel so the next log review shows when and who cleared
      await db.insertAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email ?? null,
        userName: ctx.user.name ?? null,
        ip: ctx.clientIp ?? "unknown",
        country: null, region: null, city: null,
        action: "logs_cleared",
        detail: null,
      });
      return { success: true };
    }),
  }),

  // Per-user ComfyUI server usage logs (detailed: server/host, model, status,
  // duration, result, error) + per-user / per-server analytics.
  comfyLogs: router({
    list: adminProcedure
      .input(z.object({
        // 上限 1000：管理面板分页用 50，「导出」按 1000/页 循环拉取。
        limit: z.number().int().min(1).max(1000).default(50),
        offset: z.number().int().min(0).default(0),
        userId: z.number().int().optional(),
        host: z.string().max(255).optional(),
        status: z.enum(["success", "error"]).optional(),
        action: z.string().max(64).optional(),
        sinceMs: z.number().int().optional(),
      }))
      .query(async ({ input }) => db.getComfyUsageLogs(input)),

    summary: adminProcedure
      .input(z.object({ sinceMs: z.number().int().optional() }).optional())
      .query(async ({ input }) => db.getComfyUsageSummary({ sinceMs: input?.sinceMs })),

    clear: operatorProc.mutation(async () => {
      await db.clearComfyUsageLogs();
      return { success: true };
    }),
  }),

  whitelist: router({
    getSettings: adminProcedure.query(async () => {
      const settings = await db.getWhitelistSettings();
      return { enabled: settings?.enabled ?? false, comfyuiBypass: settings?.comfyuiBypass ?? false, llmBypass: settings?.llmBypass ?? false, kieEnabled: settings?.kieEnabled ?? false };
    }),

    setKieEnabled: managerProc
      .input(z.object({ kieEnabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setWhitelistKieEnabled(input.kieEnabled);
        invalidateWhitelistCache();
        return { success: true };
      }),

    setEnabled: managerProc
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setWhitelistEnabled(input.enabled);
        invalidateWhitelistCache();
        return { success: true };
      }),

    setComfyuiBypass: managerProc
      .input(z.object({ comfyuiBypass: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setWhitelistComfyuiBypass(input.comfyuiBypass);
        invalidateWhitelistCache();
        return { success: true };
      }),

    setLlmBypass: managerProc
      .input(z.object({ llmBypass: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setWhitelistLlmBypass(input.llmBypass);
        invalidateWhitelistCache();
        return { success: true };
      }),

    listEntries: adminProcedure.query(async () => {
      return db.getWhitelistEntries();
    }),

    addEntry: operatorProc
      .input(z.object({
        type: z.enum(["ip", "user"]),
        value: z.string().min(1).max(320),
        note: z.string().max(500).optional(),
      }).refine(
        (d) => d.type !== "user" || /^\d+$/.test(d.value),
        { message: "用户类型白名单的 value 必须为纯数字用户 ID", path: ["value"] }
      ).refine(
        (d) => d.type !== "ip" || /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$|^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){2,7}$/.test(d.value),
        { message: "IP 类型白名单的 value 必须为合法的 IPv4（如 1.2.3.4）或 IPv6 地址", path: ["value"] }
      ))
      .mutation(async ({ ctx, input }) => {
        await db.addWhitelistEntry(input.type, input.value, input.note ?? null, ctx.user.id);
        invalidateWhitelistCache();
        return { success: true };
      }),

    removeEntry: operatorProc
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        const deleted = await db.removeWhitelistEntry(input.id);
        if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "白名单条目不存在" });
        invalidateWhitelistCache();
        return { success: true };
      }),
  }),

  // kie.ai distributed-key management (encrypted at rest; never in env).
  kie: router({
    cryptoConfigured: adminProcedure.query(() => ({ configured: isKieCryptoConfigured() })),

    listKeys: adminProcedure.query(async () => db.listKieKeysWithCounts()),

    addKey: managerProc
      .input(z.object({
        name: z.string().trim().min(1).max(128),
        apiKey: z.string().trim().min(8).max(256),
        note: z.string().max(255).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!isKieCryptoConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未配置 KIE_KEY_SECRET，无法加密存储 kie 密钥" });
        // Best-effort liveness check (returns null on failure — still allow storing).
        const credit = await fetchKieCredit(input.apiKey);
        const res = await db.addKieKey({
          name: input.name, encryptedKey: encryptKieKey(input.apiKey),
          keyLast4: kieKeyLast4(input.apiKey), keyHash: kieKeyHash(input.apiKey),
          note: input.note ?? null, createdBy: ctx.user.id,
        });
        if (!res) throw new TRPCError({ code: "CONFLICT", message: "该 kie 密钥已存在" });
        writeAuditLog({ ctx, action: "kie_key_add", detail: { id: res.id, name: input.name, last4: kieKeyLast4(input.apiKey) } });
        return { id: res.id, credit };
      }),

    setKeyEnabled: managerProc
      .input(z.object({ keyId: z.number().int(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const ok = await db.setKieKeyEnabled(input.keyId, input.enabled);
        if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "kie 密钥不存在" });
        writeAuditLog({ ctx, action: "kie_key_toggle", detail: { keyId: input.keyId, enabled: input.enabled } });
        return { success: true };
      }),

    deleteKey: managerProc
      .input(z.object({ keyId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const ok = await db.deleteKieKey(input.keyId);
        if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "kie 密钥不存在" });
        writeAuditLog({ ctx, action: "kie_key_delete", detail: { keyId: input.keyId } });
        return { success: true };
      }),

    listBindings: adminProcedure
      .input(z.object({ keyId: z.number().int() }))
      .query(async ({ input }) => db.listKieBindings(input.keyId)),

    bindUser: managerProc
      .input(z.object({ keyId: z.number().int(), userId: z.number().int().positive(), note: z.string().max(255).optional() }))
      .mutation(async ({ ctx, input }) => {
        const user = await db.getUserById(input.userId);
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
        const res = await db.bindKieUser(input.keyId, input.userId, input.note ?? null, ctx.user.id);
        if (!res) throw new TRPCError({ code: "CONFLICT", message: "该用户已绑定此 key" });
        writeAuditLog({ ctx, action: "kie_bind", detail: { keyId: input.keyId, userId: input.userId } });
        return { id: res.id };
      }),

    setBindingEnabled: managerProc
      .input(z.object({ bindingId: z.number().int(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const ok = await db.setKieBindingEnabled(input.bindingId, input.enabled);
        if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "绑定不存在" });
        writeAuditLog({ ctx, action: "kie_binding_toggle", detail: { bindingId: input.bindingId, enabled: input.enabled } });
        return { success: true };
      }),

    unbind: managerProc
      .input(z.object({ bindingId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const ok = await db.deleteKieBinding(input.bindingId);
        if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "绑定不存在" });
        writeAuditLog({ ctx, action: "kie_unbind", detail: { bindingId: input.bindingId } });
        return { success: true };
      }),
  }),

  storage: router({
    getSettings: adminProcedure.query(async () => {
      return db.getStorageSettings();
    }),

    setPersist: managerProc
      .input(z.object({
        persistAudio: z.boolean().optional(),
        persistVideo: z.boolean().optional(),
        persistImage: z.boolean().optional(),
        // Presigned GET URL validity for self-hosted S3/MinIO: 1 min … 7 days.
        presignTtlSec: z.number().int().min(60).max(604_800).optional(),
        // Poyo stream-upload fallback (additive; off by default).
        poyoUploadFallback: z.boolean().optional(),
        // Restrict object storage to MinIO/S3 only (disable Forge fallback).
        minioOnly: z.boolean().optional(),
        // Prefer the upstream AI temporary public URL as the reference source when alive.
        preferUpstreamRefSource: z.boolean().optional(),
        // Strict download authorization master switch.
        downloadAuthEnabled: z.boolean().optional(),
        // Anti-leech: always stream through (never expose raw presigned URL).
        forceStorageRelay: z.boolean().optional(),
        // Anti-leech: page-level identity watermark for traceability.
        watermarkEnabled: z.boolean().optional(),
        // Anti-leech: burn the downloader's identity into image/video downloads.
        downloadWatermarkEnabled: z.boolean().optional(),
        // Anti-leech deterrent: block context menu + devtools shortcuts (non-admin).
        devtoolsBlockEnabled: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        if (
          input.persistAudio === undefined && input.persistVideo === undefined &&
          input.persistImage === undefined && input.presignTtlSec === undefined &&
          input.poyoUploadFallback === undefined && input.minioOnly === undefined &&
          input.preferUpstreamRefSource === undefined && input.downloadAuthEnabled === undefined &&
          input.forceStorageRelay === undefined && input.watermarkEnabled === undefined &&
          input.downloadWatermarkEnabled === undefined && input.devtoolsBlockEnabled === undefined
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "至少需要指定一项设置" });
        }
        await db.setStorageSettings(input);
        invalidateStorageSettingsCache();
        return { success: true };
      }),

    // Active health check — uploads a tiny test object to Manus S3 and
    // returns the result. Lets the admin verify that storagePut actually
    // works rather than guessing from "the URL still looks like upstream"
    // (which can be caused by Forge config missing, S3 quota, network, etc.).
    test: managerProc.mutation(async () => {
      const t0 = Date.now();
      // Cheap config check first so the error message points at the actual
      // root cause rather than a downstream symptom.
      if (!isStorageConfigured()) {
        return {
          ok: false as const,
          ms: Date.now() - t0,
          stage: "config" as const,
          backend: "none" as const,
          error: "未配置对象存储 — 请设置 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY（自建 MinIO，推荐），或 BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY。可运行 deploy\\setup-minio.bat 一键配置。",
        };
      }
      try {
        const probeBytes = Buffer.from(`persistence-probe-${Date.now()}`, "utf8");
        const { url } = await storagePut(`probe/probe-${Date.now()}.txt`, probeBytes, "text/plain");
        return {
          ok: true as const,
          ms: Date.now() - t0,
          backend: storageBackend(),
          url,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Stage classification helps the admin act: "config" → check env,
        // "presign" → Forge backend up but rejecting auth, "upload" → S3
        // reachable but PUT failed (quota / permission).
        let stage: "config" | "presign" | "upload" | "unknown" = "unknown";
        if (/Storage config missing/i.test(msg)) stage = "config";
        else if (/presign/i.test(msg)) stage = "presign";
        else if (/upload/i.test(msg) || /S3/i.test(msg)) stage = "upload";
        return {
          ok: false as const,
          ms: Date.now() - t0,
          stage,
          backend: storageBackend(),
          error: msg.slice(0, 500),
        };
      }
    }),
  }),

  // ── Model visibility toggles ──────────────────────────────────────────
  // Admin controls which AI models appear in the node model pickers. Display-only
  // gate (does not affect already-configured nodes' ability to run their model).
  models: router({
    getDisabled: adminProcedure.query(async () => {
      return { disabledModels: await db.getDisabledModels() };
    }),
    setDisabled: managerProc
      .input(z.object({ disabledModels: z.array(z.string().max(120)).max(2000) }))
      .mutation(async ({ input }) => {
        await db.setDisabledModels(input.disabledModels);
        invalidateModelTogglesCache();
        return { success: true };
      }),
    // ── 自建 OpenAI 兼容 LLM 配置（admin） ──
    getSelfHostedLlm: adminProcedure.query(async () => db.getSelfHostedLlmConfig()),
    setSelfHostedLlm: managerProc
      .input(z.object({
        url: z.string().trim().max(2048),
        apiKey: z.string().max(512).default(""),
        models: z.array(z.object({ id: z.string().min(1).max(120), label: z.string().max(120) })).max(50),
      }))
      .mutation(async ({ input }) => {
        // 仅接受 http(s)（与代理一致），允许内网地址（部署方自有服务器）。
        const url = input.url.trim();
        if (url && !/^https?:\/\//i.test(url)) throw new TRPCError({ code: "BAD_REQUEST", message: "地址必须以 http:// 或 https:// 开头" });
        await db.setSelfHostedLlmConfig({ url, apiKey: input.apiKey, models: input.models });
        await reloadSelfHostedConfig(); // 立即热更新路由/门控缓存
        return { success: true };
      }),
  }),

  // ── 内置公网隧道（cloudflared）+ 单独白名单 ──
  tunnel: router({
    get: adminProcedure.query(async () => {
      const s = await db.getTunnelSettings();
      const rt = getTunnelRuntimeStatus();
      // 绝不回传 token 明文，只给「是否已配置」。
      const e = s.emailNotify;
      return { enabled: s.enabled, runCloudflared: s.runCloudflared, hasToken: !!s.token.trim(), publicUrl: rt.publicUrl || s.publicUrl, running: rt.running, error: rt.error, originPort: getTunnelListenerPort(), whitelistUsers: s.whitelistUsers, whitelistIps: s.whitelistIps,
        email: { to: e.to, host: e.host, port: e.port, user: e.user, secure: e.secure, from: e.from, hasPass: !!e.pass } }; // 不回传 pass 明文
    }),
    setEmailNotify: managerProc.input(z.object({
      to: z.string().max(320), host: z.string().max(255), port: z.number().int().min(1).max(65535),
      user: z.string().max(255), pass: z.string().max(512).optional(), secure: z.boolean(), from: z.string().max(320),
    })).mutation(async ({ input }) => {
      const cur = await db.getTunnelSettings();
      await db.setTunnelSettings({ emailNotify: {
        to: input.to.trim(), host: input.host.trim(), port: input.port,
        user: input.user.trim(), pass: input.pass !== undefined ? input.pass : cur.emailNotify.pass, // 留空保持原密码
        secure: input.secure, from: input.from.trim(),
      } });
      return { success: true };
    }),
    testEmail: managerProc.mutation(async () => {
      const s = await db.getTunnelSettings();
      const url = (getTunnelRuntimeStatus().publicUrl || s.publicUrl) || "https://example.trycloudflare.com（测试）";
      const r = await sendTunnelUrlEmail(s.emailNotify, url);
      if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "测试邮件发送失败：" + (r.error ?? "未知错误") });
      return { success: true };
    }),
    setEnabled: managerProc.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => {
      await applyTunnelEnabled(input.enabled);
      return { success: true };
    }),
    setConfig: managerProc.input(z.object({ token: z.string().max(4096).optional(), publicUrl: z.string().max(512).optional(), runCloudflared: z.boolean().optional() })).mutation(async ({ input }) => {
      const patch: { token?: string; publicUrl?: string; runCloudflared?: boolean } = {};
      if (input.runCloudflared !== undefined) patch.runCloudflared = input.runCloudflared;
      if (input.token !== undefined) patch.token = input.token.trim();
      if (input.publicUrl !== undefined) {
        const u = input.publicUrl.trim();
        if (u && !/^https?:\/\//i.test(u) && !/^[a-z0-9.-]+$/i.test(u)) throw new TRPCError({ code: "BAD_REQUEST", message: "公网地址应为域名或 http(s) URL" });
        patch.publicUrl = u;
      }
      await db.setTunnelSettings(patch);
      await reloadTunnelGate();
      return { success: true };
    }),
    // cloudflared 二进制状态（是否已装/可自动下载/下载进度）
    cloudflared: adminProcedure.query(() => cloudflaredInfo()),
    downloadCloudflared: managerProc.mutation(async () => {
      void startCloudflaredDownload(); // 后台下载，前端轮询 cloudflared 查询
      return { started: true };
    }),
    setWhitelist: managerProc.input(z.object({
      whitelistUsers: z.array(z.number().int()).max(2000),
      whitelistIps: z.array(z.string().max(64)).max(2000),
    })).mutation(async ({ input }) => {
      await db.setTunnelSettings({ whitelistUsers: input.whitelistUsers, whitelistIps: input.whitelistIps });
      await reloadTunnelGate();
      return { success: true };
    }),
  }),

  // ── Chat administration (cross-user moderation + history) ──────────────
  // Admin-only. Server-mode conversations expose full plaintext history;
  // serverless (E2E) conversations expose metadata only — the server never
  // had their content.
  chat: router({
    listConversations: adminProcedure
      .input(z.object({
        type: z.enum(["lobby", "group", "dm"]).optional(),
        mode: z.enum(["server", "serverless"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const { rows, total } = await db.adminListConversations(input);
        const enriched = await Promise.all(rows.map(async (c) => {
          // Per-row fallback: one failed member lookup must not 500 the whole list.
          const members = await db.listChatMembers(c.id).catch(() => []);
          return {
            id: c.id, type: c.type, mode: c.mode, title: c.title,
            isPrivate: !!c.passwordHash, memberCount: members.length,
            createdBy: c.createdBy, createdAt: c.createdAt,
          };
        }));
        return { rows: enriched, total };
      }),

    getConversation: adminProcedure
      .input(z.object({ conversationId: z.number().int() }))
      .query(async ({ input }) => {
        const conv = await db.getConversationById(input.conversationId);
        if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
        const members = await db.listChatMembers(conv.id);
        const membersWithNames = await Promise.all(members.map(async (m) => {
          const u = await db.getUserById(m.userId).catch(() => undefined);
          return { userId: m.userId, name: u?.name ?? `用户${m.userId}`, role: m.role };
        }));
        return { id: conv.id, type: conv.type, mode: conv.mode, title: conv.title, members: membersWithNames };
      }),

    searchMessages: adminProcedure
      .input(z.object({
        userId: z.number().int().optional(),
        conversationId: z.number().int().optional(),
        keyword: z.string().max(200).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        // If filtering by a specific conversation that is serverless, return
        // metadata-only (no content ever existed server-side).
        if (input.conversationId) {
          const conv = await db.getConversationById(input.conversationId);
          if (conv && conv.mode === "serverless") {
            return { rows: [], total: 0, encrypted: true as const };
          }
        }
        const { rows, total } = await db.adminSearchMessages({
          userId: input.userId,
          conversationId: input.conversationId,
          keyword: input.keyword,
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
          dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
          limit: input.limit,
          offset: input.offset,
        });
        return {
          rows: rows.map((r) => ({
            id: r.id, conversationId: r.conversationId, senderId: r.senderId,
            senderName: r.senderName, content: r.content, attachments: r.attachments,
            createdAt: r.createdAt,
          })),
          total,
          encrypted: false as const,
        };
      }),

    listFiles: adminProcedure
      .input(z.object({
        conversationId: z.number().int().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const { rows, total } = await db.adminListAttachments(input);
        return {
          rows: rows.map((a) => ({
            id: a.id, conversationId: a.conversationId, uploaderId: a.uploaderId,
            name: a.name, url: a.url, mimeType: a.mimeType, size: a.size, kind: a.kind,
            createdAt: a.createdAt,
          })),
          total,
        };
      }),

    deleteMessage: managerProc
      .input(z.object({ messageId: z.number().int() }))
      .mutation(async ({ input }) => {
        await db.deleteConversationMessage(input.messageId);
        return { success: true };
      }),

    deleteConversation: managerProc
      .input(z.object({ conversationId: z.number().int() }))
      .mutation(async ({ input }) => {
        await db.deleteConversation(input.conversationId);
        return { success: true };
      }),

    banUser: managerProc
      .input(z.object({
        userId: z.number().int(),
        scope: z.enum(["global", "conversation"]),
        conversationId: z.number().int().optional(),
        reason: z.string().max(255).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.scope === "conversation" && input.conversationId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "会话封禁需指定会话" });
        }
        const row = await db.addChatBan({
          userId: input.userId, scope: input.scope,
          conversationId: input.scope === "conversation" ? input.conversationId : null,
          reason: input.reason ?? null, bannedBy: ctx.user.id,
        });
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return { id: row.id };
      }),

    unbanUser: managerProc
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await db.removeChatBan(input.id);
        return { success: true };
      }),

    listBans: adminProcedure.query(async () => {
      const rows = await db.listChatBans();
      return Promise.all(rows.map(async (b) => {
        const u = await db.getUserById(b.userId).catch(() => undefined);
        return {
          id: b.id, userId: b.userId, userName: u?.name ?? `用户${b.userId}`,
          scope: b.scope, conversationId: b.conversationId, reason: b.reason, createdAt: b.createdAt,
        };
      }));
    }),

    getSettings: adminProcedure.query(async () => {
      const s = await db.getChatSettings();
      return { serverlessAllowed: s.serverlessAllowed, lobbyEnabled: s.lobbyEnabled, maxFileMb: s.maxFileMb };
    }),

    setSettings: managerProc
      .input(z.object({
        serverlessAllowed: z.boolean().optional(),
        lobbyEnabled: z.boolean().optional(),
        maxFileMb: z.number().int().min(1).max(5120).optional(),
      }))
      .mutation(async ({ input }) => {
        const s = await db.setChatSettings(input);
        return { serverlessAllowed: s.serverlessAllowed, lobbyEnabled: s.lobbyEnabled, maxFileMb: s.maxFileMb };
      }),
  }),

  // ── 用户管理（仅管理员）：列表 / 重置密码 / 冻结·解冻 / 删除 ──
  users: router({
    list: adminProcedure.query(async () => {
      return db.listAllUsers();
    }),
    resetPassword: managerProc
      .input(z.object({ userId: z.number().int().positive(), newPassword: z.string().min(6).max(200) }))
      .mutation(async ({ ctx, input }) => {
        await db.adminSetUserPassword(input.userId, await hashPassword(input.newPassword));
        writeAuditLog({ ctx, action: "user_reset_password", detail: { userId: input.userId } });
        return { success: true };
      }),
    setDisabled: operatorProc
      .input(z.object({ userId: z.number().int().positive(), disabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "不能冻结自己" });
        await db.setUserDisabled(input.userId, input.disabled);
        writeAuditLog({ ctx, action: "user_set_disabled", detail: { userId: input.userId, disabled: input.disabled } });
        return { success: true };
      }),
    delete: managerProc
      .input(z.object({ userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除自己" });
        await db.deleteUserById(input.userId);
        writeAuditLog({ ctx, action: "user_delete", detail: { userId: input.userId } });
        return { success: true };
      }),
    // 设置某用户的管理员级别（0=普通·1=查看员·2=运营·3=管理员·4=超管）——仅超管(L4)。
    // 加管理员 = 设为 ≥1；降为普通 = 设 0。禁止改自己（防自我锁死/误降）。
    setLevel: superProc
      .input(z.object({ userId: z.number().int().positive(), level: z.number().int().min(0).max(4) }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "不能修改自己的管理员级别" });
        await db.setUserAdminLevel(input.userId, input.level);
        writeAuditLog({ ctx, action: "admin_set_level", detail: { userId: input.userId, level: input.level } });
        return { success: true };
      }),
  }),

  // ── 系统更新（应用内一键更新；仅超管 L4）──
  update: router({
    version: adminProcedure.query(async () => {
      return getVersionInfo();
    }),
    // 红点提醒用：带 15 分钟缓存，频繁查询不会频繁 git fetch
    available: adminProcedure.query(async () => {
      return getUpdateAvailable(false);
    }),
    // 手动「检查更新」：强制刷新缓存
    check: superProc.mutation(async () => {
      return getUpdateAvailable(true);
    }),
    status: adminProcedure.query(() => {
      return getUpdateStatus();
    }),
    run: superProc.mutation(async () => {
      return startUpdate();
    }),
    // 仅重启服务（不更新代码）——用于加载手动改过的 .env。退出进程由 NSSM/pm2 拉起。
    restart: superProc.mutation(async ({ ctx }) => {
      writeAuditLog({ ctx, action: "system_restart", detail: {} });
      return restartServer();
    }),
  }),
});
