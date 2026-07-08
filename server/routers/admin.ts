import { z } from "zod";
import { isIP } from "net";
import { TRPCError } from "@trpc/server";
import { adminProcedure, levelProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { getOnlineUserIds } from "../_core/presence";
import { invalidateWhitelistCache } from "../_core/whitelist";
import { invalidateStorageSettingsCache } from "../_core/storageConfig";
import { invalidateModelTogglesCache } from "../_core/modelToggles";
import { invalidateSystemDefaultModelsCache } from "../_core/systemDefaultModels";
import { reloadSelfHostedConfig } from "../_core/selfHostedLlm";
import { reloadBridgeMcpConfig } from "../_core/bridgeMcp";
import { bridgeLocalUrl } from "../_core/claudeBridge";
import { buildConfigChecklist } from "../_core/configChecklist";
import { applyTunnelEnabled, getTunnelRuntimeStatus, reloadTunnelGate, getTunnelListenerPort, getTunnelLog, getTunnelThroughput, getTunnelPid } from "../_core/tunnel";
import { detectGatewayForSource, detectLineForSource, applyTunnelRoutes, removeTunnelRoutes, tunnelRouteStatus, localInterfaceIps, isLocalInterfaceIp, tunnelEgressInfo, fetchPublicEgressIp, fetchLinePublicEgressIp, tunnelDiagnose } from "../_core/tunnelRoute";
import { cloudflaredInfo, startCloudflaredDownload } from "../_core/cloudflaredBin";
import { tunnelHostFromUrl } from "../_core/tunnelGate";
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
  "superagent_comfy_build", "superagent_code_task",
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
    // 「白名单管理」限管理员 L3+：条目查看/增删（listEntries/addEntry/removeEntry）与开关（setEnabled/
    // setComfyuiBypass/setLlmBypass/setKieEnabled）都是 managerProc。getSettings 只回 4 个功能布尔标志
    // （非敏感的白名单条目），且被 KiePanel 等跨面板只读引用，故保持 adminProcedure 可读。
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

    listEntries: managerProc.query(async () => {
      return db.getWhitelistEntries();
    }),

    addEntry: managerProc
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

    removeEntry: managerProc
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
        // 免受下载门控的最低管理级别（adminLevel>=此值免门控）：1=仅普通成员受控(默认)，
        // 调高则低级管理员也受控；5=所有人（含最高管理员）都受控。
        downloadAuthBypassLevel: z.number().int().min(1).max(5).optional(),
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
          input.downloadAuthBypassLevel === undefined &&
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

  // ── Auth settings: registration email-verification toggle + SMTP ──────
  auth: router({
    getSettings: adminProcedure.query(async () => {
      const s = await db.getAuthSettings();
      // Never leak the SMTP password — expose only whether one is configured.
      return { ...s, smtpPass: "", smtpPassSet: s.smtpPass.length > 0 };
    }),
    setSettings: managerProc
      .input(z.object({
        emailVerificationEnabled: z.boolean().optional(),
        registrationApprovalEnabled: z.boolean().optional(),
        smtpHost: z.string().max(255).optional(),
        smtpPort: z.number().int().min(1).max(65535).optional(),
        smtpSecure: z.boolean().optional(),
        smtpUser: z.string().max(255).optional(),
        smtpPass: z.string().max(255).optional(),
        smtpFrom: z.string().max(320).optional(),
      }))
      .mutation(async ({ input }) => {
        // Empty smtpPass = "leave unchanged" (the client never receives the real
        // password, so a blank submit must not wipe it).
        const patch: Record<string, unknown> = { ...input };
        if (patch.smtpPass === "") delete patch.smtpPass;
        if (Object.keys(patch).length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "至少需要指定一项设置" });
        await db.setAuthSettings(patch);
        return { success: true };
      }),
    // One-click: copy the SMTP account configured on the 公网隧道 page into the
    // auth settings (server-side, so the password is shared without ever leaving
    // the server). Lets both features reuse a single SMTP account.
    importFromTunnel: managerProc.mutation(async () => {
      const t = await db.getTunnelSettings();
      const e = t.emailNotify;
      if (!e || !e.host?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "公网隧道页尚未配置 SMTP（请先在「公网隧道」页填写邮件通知的 SMTP）" });
      }
      await db.setAuthSettings({
        smtpHost: e.host.trim(), smtpPort: e.port || 587, smtpSecure: !!e.secure,
        smtpUser: e.user ?? "", smtpPass: e.pass ?? "", smtpFrom: (e.from || e.user) ?? "",
      });
      return { success: true, hasPass: !!(e.pass && e.pass.length > 0) };
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
    // bridgeLocalUrl：本机桥接的真实回环地址（127.0.0.1:内部端口），供前端「一键填入」直接用，
    // 避免填成公网隧道域名（功能上服务端会强制重写回环，但显示公网地址误导人）。
    getSelfHostedLlm: adminProcedure.query(async () => ({ ...(await db.getSelfHostedLlmConfig()), bridgeLocalUrl: bridgeLocalUrl() })),
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
    // ── 桥接 MCP/技能配置（admin）：替代 CLAUDE_BRIDGE_* env，界面贴 JSON 保存即生效（无需重启） ──
    getBridgeMcp: adminProcedure.query(async () => db.getBridgeMcpConfig()),
    setBridgeMcp: managerProc
      .input(z.object({
        mcpConfig: z.string().max(20000).default(""),
        skills: z.boolean().default(false),
        strict: z.boolean().default(true),
        permissionMode: z.string().trim().max(40).default(""),
        allowedTools: z.string().trim().max(2000).default(""),
      }))
      .mutation(async ({ input }) => {
        const mcpConfig = input.mcpConfig.trim();
        // 内联 JSON（以 { 开头）必须合法且含 mcpServers 对象——否则每次桥接请求都会静默解析失败、丢掉 MCP。
        // 文件路径形式（非 { 开头）不在此校验（服务器上是否存在由运行时读取时兜底）。
        if (mcpConfig.startsWith("{")) {
          let parsed: unknown;
          try { parsed = JSON.parse(mcpConfig); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "MCP 配置不是合法 JSON" }); }
          const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
          if (!servers || typeof servers !== "object") throw new TRPCError({ code: "BAD_REQUEST", message: "MCP 配置缺少 mcpServers 对象" });
        }
        await db.setBridgeMcpConfig({ mcpConfig, skills: input.skills, strict: input.strict, permissionMode: input.permissionMode, allowedTools: input.allowedTools });
        await reloadBridgeMcpConfig(); // 立即热更新桥接增强参数缓存
        return { success: true };
      }),
    // ── 系统默认模型（admin）：按槽位 llm/image/video/transcribe，作用于所有项目 ──
    getSystemDefaults: adminProcedure.query(async () => db.getSystemDefaultModels()),
    setSystemDefaults: managerProc
      .input(z.object({
        llm: z.string().max(120).optional(),
        image: z.string().max(120).optional(),
        video: z.string().max(120).optional(),
        transcribe: z.string().max(120).optional(),
      }))
      .mutation(async ({ input }) => {
        // 空串/未填 = 该槽位不设系统默认（回退出厂默认）；只落非空项。
        const cfg: Record<string, string> = {};
        for (const slot of ["llm", "image", "video", "transcribe"] as const) {
          const v = input[slot]?.trim();
          if (v) cfg[slot] = v;
        }
        await db.setSystemDefaultModels(cfg);
        invalidateSystemDefaultModelsCache();
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
      return { enabled: s.enabled, runCloudflared: s.runCloudflared, hasToken: !!s.token.trim(), preferQuick: s.preferQuick, publicUrl: rt.publicUrl || s.publicUrl, running: rt.running, error: rt.error, originPort: getTunnelListenerPort(), whitelistUsers: s.whitelistUsers, whitelistIps: s.whitelistIps, edgeBindAddress: s.edgeBindAddress, log: getTunnelLog(),
        throughput: getTunnelThroughput(), // 用户经隧道的实时吞吐（被动统计）
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
    setConfig: managerProc.input(z.object({ token: z.string().max(4096).optional(), publicUrl: z.string().max(512).optional(), runCloudflared: z.boolean().optional(), preferQuick: z.boolean().optional(), edgeBindAddress: z.string().max(64).optional() })).mutation(async ({ input }) => {
      const patch: { token?: string; publicUrl?: string; runCloudflared?: boolean; preferQuick?: boolean; edgeBindAddress?: string } = {};
      if (input.runCloudflared !== undefined) patch.runCloudflared = input.runCloudflared;
      if (input.preferQuick !== undefined) patch.preferQuick = input.preferQuick;
      if (input.token !== undefined) patch.token = input.token.trim();
      if (input.publicUrl !== undefined) {
        const u = input.publicUrl.trim();
        if (u && !/^https?:\/\//i.test(u) && !/^[a-z0-9.-]+$/i.test(u)) throw new TRPCError({ code: "BAD_REQUEST", message: "公网地址应为域名或 http(s) URL" });
        patch.publicUrl = u;
      }
      let clearedProLine = false;
      if (input.edgeBindAddress !== undefined) {
        const ip = input.edgeBindAddress.trim();
        if (ip && isIP(ip) === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "出口专线绑定应填合法的本机源 IP（IPv4/IPv6），留空=系统默认路由" });
        // 防呆：edge-bind 必须是本机某网卡地址，否则 cloudflared 绑定出网会报 "address not valid in its
        // context" 而整个隧道起不来（笔误最常见）。校验不过就明确列出本机可用 IP 让用户改。
        if (ip && !isLocalInterfaceIp(ip)) {
          const { v4, v6 } = localInterfaceIps();
          const avail = [...v4, ...v6].join("、") || "（未检测到网卡地址）";
          throw new TRPCError({ code: "BAD_REQUEST", message: `${ip} 不是本机任何网卡的地址，cloudflared 无法绑定它出网（会报 "address not valid in its context" 导致隧道起不来）。本机可用源 IP：${avail}。填其中一个，或留空用默认线路。` });
        }
        patch.edgeBindAddress = ip;
        // 把「出口专线绑定」清空 = 关闭专线：自动移除已为命名隧道加的 CF 边缘专线路由，回退默认线路。
        const prev = ((await db.getTunnelSettings()).edgeBindAddress ?? "").trim();
        if (!ip && prev) clearedProLine = true;
      }
      await db.setTunnelSettings(patch);
      let routeRevert: { ok: boolean; log: string } | undefined;
      if (clearedProLine) routeRevert = await removeTunnelRoutes(getTunnelLog());
      await reloadTunnelGate();
      return { success: true, routeReverted: !!routeRevert, routeLog: routeRevert?.log };
    }),
    // 显示已保存的命名隧道 Token 明文（供管理员查看/复制）。仅显式触发返回，绝不随 get 常规回传。
    revealToken: managerProc.mutation(async () => ({ token: (await db.getTunnelSettings()).token })),
    // cloudflared 二进制状态（是否已装/可自动下载/下载进度）
    cloudflared: adminProcedure.query(() => cloudflaredInfo()),
    downloadCloudflared: managerProc.mutation(async () => {
      void startCloudflaredDownload(); // 后台下载，前端轮询 cloudflared 查询
      return { started: true };
    }),
    // 连通性自检：从服务器去 GET 自己的公网地址（经 Cloudflare→隧道→回源）。能拿到响应=端到端通；
    // Cloudflare 5xx=回源失败（cloudflared 没连上 / 回源端口不对）；网络错=DNS 未生效 / 隧道没运行。
    checkConnectivity: adminProcedure.mutation(async () => {
      const s = await db.getTunnelSettings();
      const host = tunnelHostFromUrl(getTunnelRuntimeStatus().publicUrl || s.publicUrl);
      if (!host) return { reachable: false as const, error: "尚无公网地址：先启用快速隧道，或在配置里填命名隧道的公网域名" };
      try {
        const res = await fetch(`https://${host}/`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "avc-tunnel-selfcheck" } });
        const CF_DOWN = new Set([502, 503, 520, 521, 522, 523, 530]);
        if (CF_DOWN.has(res.status)) return { reachable: false as const, status: res.status, error: `Cloudflare 回源失败（HTTP ${res.status}）：cloudflared 未连上或回源端口不对` };
        return { reachable: true as const, status: res.status, host };
      } catch (e) {
        return { reachable: false as const, error: (e as Error).message.slice(0, 140) + "（DNS 未生效 / 隧道未运行 / 网络不通？）" };
      }
    }),
    // 本机各网卡可用源 IP（供「出口专线绑定」选择/防呆，避免填错导致隧道起不来）。
    localSourceIps: adminProcedure.query(() => localInterfaceIps()),
    // 隧道出站实际走哪张网卡 / 哪个源 IP（快速隧道靠 edge-bind 绑定；其余按内核选路，专线路由如实反映）。
    egress: adminProcedure.query(async () => {
      const s = await db.getTunnelSettings();
      const named = s.token.trim().length > 0 && !s.preferQuick;
      return tunnelEgressInfo((s.edgeBindAddress ?? "").trim(), !named, getTunnelLog());
    }),
    // 实测公网出口 IP（与 CF 连接器面板对齐）。所选专线线路：临时把 trace 目标 /32 钉到「出口专线绑定」
    // 源 IP 对应的网卡实测（绑源 IP 在 Windows 不改出口网卡，故必须临时路由才能测准）；默认线路：不绑直测。
    egressPublicIp: adminProcedure.mutation(async () => {
      const s = await db.getTunnelSettings();
      const bind = (s.edgeBindAddress ?? "").trim();
      const line = isIP(bind) ? await detectLineForSource(bind) : { ifIndex: null, ifName: null, gateway: null };
      const [lineRes, defaultIp] = await Promise.all([
        (isIP(bind) && line.gateway) ? fetchLinePublicEgressIp(line) : Promise.resolve({ ip: null as string | null, viaLine: false, note: "未设「出口专线绑定」，无法测专线线路" }),
        fetchPublicEgressIp(undefined),
      ]);
      return { sourceIp: bind || null, iface: line.ifName, publicIp: lineRes.ip, viaLine: lineRes.viaLine, note: lineRes.note, defaultLinePublicIp: defaultIp };
    }),
    // ── 专线路由：让命名隧道走指定专线（cloudflared 绑定对 token 隧道无效，只能走 OS 路由）──
    // 探测「出口专线绑定」源 IP 所属网卡的默认网关（供 UI 预填，用户可改）。
    detectRouteGateway: adminProcedure.mutation(async () => {
      const s = await db.getTunnelSettings();
      const ip = (s.edgeBindAddress ?? "").trim();
      if (!isIP(ip)) return { gateway: null as string | null, sourceIp: ip, error: "请先在「出口专线绑定」填该专线本机网卡的源 IP" };
      return { gateway: await detectGatewayForSource(ip), sourceIp: ip };
    }),
    // 应用专线路由：把 CF 边缘网段路由到专线网关（gateway 空则自动探测）。需本服务以管理员运行。
    applyRoutes: managerProc.input(z.object({ gateway: z.string().max(64).optional() })).mutation(async ({ input }) => {
      const s = await db.getTunnelSettings();
      const ip = (s.edgeBindAddress ?? "").trim();
      const gw = (input.gateway ?? "").trim();
      if (!isIP(ip) && !isIP(gw)) throw new TRPCError({ code: "BAD_REQUEST", message: "请先填「出口专线绑定」源 IP，或直接填专线网关" });
      const r = await applyTunnelRoutes(ip, isIP(gw) ? gw : undefined, getTunnelLog());
      return r;
    }),
    removeRoutes: managerProc.mutation(async () => removeTunnelRoutes(getTunnelLog())),
    routeStatus: adminProcedure.mutation(async () => tunnelRouteStatus(getTunnelLog())),
    // 一键诊断走线：查管理员权限 + cloudflared 实际在用的源 IP（地面真相）+ 路由明细，直接给结论。
    diagnose: adminProcedure.mutation(async () => {
      const s = await db.getTunnelSettings();
      return tunnelDiagnose(getTunnelPid(), (s.edgeBindAddress ?? "").trim(), getTunnelLog());
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
    // 实时在线用户 id 列表（socket 连接引用计数）。前端轮询叠加到用户表，显示在线状态。
    onlineIds: adminProcedure.query(() => getOnlineUserIds()),
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
    // 批准 / 驳回一个待审批的注册用户（审批制）。批准 → approved=true 可登录；驳回 → 保持 false。
    setApproved: operatorProc
      .input(z.object({ userId: z.number().int().positive(), approved: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await db.setUserApproved(input.userId, input.approved);
        writeAuditLog({ ctx, action: "user_set_approved", detail: { userId: input.userId, approved: input.approved } });
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

  // ── 配置体检：汇总 .env / 数据库 / CLI·凭证三处的部署配置成一张核对清单（只回状态，无密钥值）──
  config: router({
    checklist: adminProcedure.query(async () => buildConfigChecklist()),
  }),
});
