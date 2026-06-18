import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure, levelProcedure, protectedProcedure } from "../_core/trpc";

// ComfyUI 运维（SSH 执行 / Docker / 安装 / 脚本 / 改服务器配置）属高危「管理员」级操作：
// 查看员(L1)/运营(L2) 只读看板，所有写操作需管理员(L3+)。读接口仍 adminProcedure(L1)。
const managerProc = levelProcedure(3);
import {
  listOpsServers, getOpsServer, insertOpsServer, updateOpsServer, deleteOpsServer,
  listOpsRecords, getOpsSettings, setOpsSettings,
  listOpsScripts, insertOpsScript, updateOpsScript, deleteOpsScript,
} from "../db";
import { encryptSshSecret, decryptSshSecret, sshSecretLast4, isSshCryptoConfigured } from "../_core/ops/sshCrypto";
import { testConnection, dropClient, isValidSshHost } from "../_core/ops/sshPool";
import { sshExec } from "../_core/ops/sshExec";
import { classifyCommand, mayAutoExecute } from "../_core/ops/commandPolicy";
import { dockerPs, dockerStats, dockerLogs, dockerAction, dockerInspect } from "../_core/ops/dockerOps";
import { listModels, listCustomNodes, installCustomNode, installModel, MODEL_DIRS } from "../_core/ops/modelOps";
import { aiGenerateOps } from "../_core/ops/aiOps";
import { getCurrentOpsAlerts } from "../_core/ops/opsAlerts";
import { recordOps } from "../_core/ops/opsRecords";
import { assertComfyuiAllowed, assertLLMAllowed } from "../_core/whitelist";
import { fetchComfyServerStatus, comfyErrorHint } from "../_core/comfyui";
import type { ComfyOpsServer } from "../../drizzle/schema";

// Strip secrets before any server row leaves the backend. The frontend only ever
// sees last4 + host/form metadata — never the encrypted blob or plaintext.
function sanitizeServer(s: ComfyOpsServer) {
  const { encryptedSecret: _s, encryptedPassphrase: _p, ...rest } = s;
  return { ...rest, hasPassphrase: !!s.encryptedPassphrase };
}

const serverInput = z.object({
  name: z.string().min(1).max(128),
  comfyBaseUrl: z.string().max(512).optional(),
  sshHost: z.string().min(1).max(255),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUser: z.string().min(1).max(128),
  authType: z.enum(["password", "privateKey"]),
  /** Plaintext secret (password or private key). Omit on update to keep current. */
  secret: z.string().max(8000).optional(),
  passphrase: z.string().max(800).optional(),
  deployForm: z.enum(["docker", "bare", "systemd"]).default("bare"),
  dockerContainer: z.string().max(128).optional(),
  comfyPath: z.string().max(512).optional(),
  trustMode: z.boolean().default(false),
  enabled: z.boolean().default(true),
  note: z.string().max(255).optional(),
});

export const comfyOpsRouter = router({
  // ── Servers (admin only) ──────────────────────────────────────────────────
  servers: router({
    list: adminProcedure.query(async () => {
      const rows = await listOpsServers();
      return rows.map(sanitizeServer);
    }),

    cryptoReady: adminProcedure.query(() => ({ ready: isSshCryptoConfigured() })),

    create: managerProc.input(serverInput).mutation(async ({ ctx, input }) => {
      if (!isSshCryptoConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未配置 SSH_KEY_SECRET，无法保存凭据" });
      if (!input.secret) throw new TRPCError({ code: "BAD_REQUEST", message: "新增服务器必须提供密码或私钥" });
      if (!isValidSshHost(input.sshHost)) throw new TRPCError({ code: "BAD_REQUEST", message: "SSH 主机格式非法" });
      const id = await insertOpsServer({
        name: input.name, comfyBaseUrl: input.comfyBaseUrl || null,
        sshHost: input.sshHost, sshPort: input.sshPort, sshUser: input.sshUser,
        authType: input.authType,
        encryptedSecret: encryptSshSecret(input.secret),
        encryptedPassphrase: input.passphrase ? encryptSshSecret(input.passphrase) : null,
        secretLast4: sshSecretLast4(input.secret),
        deployForm: input.deployForm, dockerContainer: input.dockerContainer || null,
        comfyPath: input.comfyPath || null, trustMode: input.trustMode,
        enabled: input.enabled, note: input.note || null, createdBy: ctx.user.id,
      });
      recordOps(ctx, { serverId: id, channel: "ssh", action: "server_add", auditAction: "ops:server_add", status: "success", detail: { name: input.name, host: input.sshHost } });
      return { id };
    }),

    update: managerProc.input(serverInput.partial().extend({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
      const { id, secret, passphrase, ...rest } = input;
      const existing = await getOpsServer(id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (rest.sshHost && !isValidSshHost(rest.sshHost)) throw new TRPCError({ code: "BAD_REQUEST", message: "SSH 主机格式非法" });
      const patch: Record<string, unknown> = {
        ...(rest.name !== undefined ? { name: rest.name } : {}),
        ...(rest.comfyBaseUrl !== undefined ? { comfyBaseUrl: rest.comfyBaseUrl || null } : {}),
        ...(rest.sshHost !== undefined ? { sshHost: rest.sshHost } : {}),
        ...(rest.sshPort !== undefined ? { sshPort: rest.sshPort } : {}),
        ...(rest.sshUser !== undefined ? { sshUser: rest.sshUser } : {}),
        ...(rest.authType !== undefined ? { authType: rest.authType } : {}),
        ...(rest.deployForm !== undefined ? { deployForm: rest.deployForm } : {}),
        ...(rest.dockerContainer !== undefined ? { dockerContainer: rest.dockerContainer || null } : {}),
        ...(rest.comfyPath !== undefined ? { comfyPath: rest.comfyPath || null } : {}),
        ...(rest.trustMode !== undefined ? { trustMode: rest.trustMode } : {}),
        ...(rest.enabled !== undefined ? { enabled: rest.enabled } : {}),
        ...(rest.note !== undefined ? { note: rest.note || null } : {}),
      };
      if (secret) { patch.encryptedSecret = encryptSshSecret(secret); patch.secretLast4 = sshSecretLast4(secret); }
      if (passphrase !== undefined) patch.encryptedPassphrase = passphrase ? encryptSshSecret(passphrase) : null;
      await updateOpsServer(id, patch);
      dropClient(id); // force reconnect with new creds/host next time
      recordOps(ctx, { serverId: id, channel: "ssh", action: "server_update", auditAction: "ops:server_update", status: "success", detail: { fields: Object.keys(patch) } });
      return { ok: true };
    }),

    delete: managerProc.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
      await deleteOpsServer(input.id);
      dropClient(input.id);
      recordOps(ctx, { serverId: input.id, channel: "ssh", action: "server_delete", auditAction: "ops:server_delete", status: "success" });
      return { ok: true };
    }),

    testConnection: managerProc.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
      const server = await getOpsServer(input.id);
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });
      return testConnection(server);
    }),
  }),

  /** Current ops alerts snapshot (offline / low VRAM / queue backlog). Live
   *  pushes arrive via the `ops:alerts` socket event to the admin room. */
  alerts: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") await assertComfyuiAllowed(ctx);
    return getCurrentOpsAlerts();
  }),

  // ── Dashboard (read-only, whitelist-gated) ────────────────────────────────
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const isAdmin = ctx.user.role === "admin";
    if (!isAdmin) await assertComfyuiAllowed(ctx);
    const servers = await listOpsServers();
    const out = await Promise.all(servers.map(async (s) => {
      // sshHost 是内部基础设施标识（运维 SSH 主机/IP），仪表盘前端并不展示它，且本接口对
      // 非管理员白名单用户开放——故仅管理员返回 sshHost，避免向普通用户泄露内网主机信息。
      const base = { id: s.id, name: s.name, deployForm: s.deployForm, enabled: s.enabled, comfyBaseUrl: s.comfyBaseUrl, ...(isAdmin ? { sshHost: s.sshHost } : {}) };
      if (!s.comfyBaseUrl || !s.enabled) return { ...base, status: null };
      const status = await fetchComfyServerStatus(s.comfyBaseUrl).catch(() => null);
      return { ...base, status };
    }));
    return out;
  }),

  // ── Quick command exec (admin only) ───────────────────────────────────────
  exec: managerProc
    .input(z.object({
      serverId: z.number().int(),
      command: z.string().min(1).max(8000),
      /** Caller acknowledged the danger (red confirm) for this run. */
      confirmedDangerous: z.boolean().default(false),
      /** Command came from the AI assistant — never auto-executes, recorded as AI-approved. */
      aiGenerated: z.boolean().default(false),
      timeoutMs: z.number().int().min(1000).max(600000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const server = await getOpsServer(input.serverId);
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });
      const risk = classifyCommand(input.command);
      if (risk.dangerous && !input.confirmedDangerous) {
        return { blocked: true as const, dangerous: true, reasons: risk.reasons };
      }
      const auto = mayAutoExecute(input.command, { trustMode: server.trustMode, aiGenerated: input.aiGenerated });
      try {
        const res = await sshExec(input.serverId, input.command, { timeoutMs: input.timeoutMs });
        recordOps(ctx, {
          serverId: input.serverId, channel: "ssh", action: "exec", auditAction: "ops:exec",
          command: input.command, approvedByAi: input.aiGenerated, autoExecuted: auto, status: res.exitCode === 0 ? "success" : "error",
          exitCode: res.exitCode, durationMs: res.durationMs, output: res.output,
          detail: { dangerous: risk.dangerous, timedOut: res.timedOut },
        });
        return { blocked: false as const, exitCode: res.exitCode, output: res.output, timedOut: res.timedOut, durationMs: res.durationMs };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        recordOps(ctx, { serverId: input.serverId, channel: "ssh", action: "exec", auditAction: "ops:exec", command: input.command, status: "error", errorMessage: msg });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),

  /** Classify a command without running it (for live danger badge in the UI). */
  classify: adminProcedure.input(z.object({ command: z.string().max(8000) })).query(({ input }) => classifyCommand(input.command)),

  // ── Docker container management (admin only, SSH) ─────────────────────────
  docker: router({
    list: adminProcedure.input(z.object({ serverId: z.number().int() })).query(async ({ input }) => {
      const [containers, stats] = await Promise.all([
        dockerPs(input.serverId),
        dockerStats(input.serverId).catch(() => []),
      ]);
      const statByName = new Map(stats.map((s) => [s.name, s]));
      return containers.map((c) => ({ ...c, stat: statByName.get(c.name) ?? null }));
    }),

    logs: adminProcedure
      .input(z.object({ serverId: z.number().int(), container: z.string().max(128), tail: z.number().int().min(1).max(5000).default(200) }))
      .query(({ input }) => dockerLogs(input.serverId, input.container, input.tail)),

    inspect: adminProcedure
      .input(z.object({ serverId: z.number().int(), container: z.string().max(128) }))
      .query(({ input }) => dockerInspect(input.serverId, input.container)),

    action: managerProc
      .input(z.object({ serverId: z.number().int(), container: z.string().max(128), action: z.enum(["start", "stop", "restart"]) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const r = await dockerAction(input.serverId, input.container, input.action);
          recordOps(ctx, {
            serverId: input.serverId, channel: "ssh", action: "docker", auditAction: "ops:exec",
            command: `docker ${input.action} ${input.container}`, status: r.ok ? "success" : "error",
            output: r.output, detail: { docker: input.action, container: input.container },
          });
          return r;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          recordOps(ctx, { serverId: input.serverId, channel: "ssh", action: "docker", auditAction: "ops:exec", command: `docker ${input.action} ${input.container}`, status: "error", errorMessage: msg });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }
      }),
  }),

  // ── Models / LoRA / custom nodes (admin only) ─────────────────────────────
  models: router({
    // Read-only model listing via the ComfyUI API (whitelist-gated like dashboard).
    list: protectedProcedure.input(z.object({ serverId: z.number().int() })).query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") await assertComfyuiAllowed(ctx);
      return listModels(input.serverId);
    }),

    nodes: adminProcedure.input(z.object({ serverId: z.number().int() })).query(({ input }) => listCustomNodes(input.serverId)),

    installNode: managerProc
      .input(z.object({ serverId: z.number().int(), gitUrl: z.string().max(512) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const r = await installCustomNode(input.serverId, input.gitUrl);
          recordOps(ctx, { serverId: input.serverId, channel: "ssh", action: "installNode", auditAction: "ops:install_node", command: r.command, status: r.ok ? "success" : "error", output: r.output, detail: { gitUrl: input.gitUrl } });
          return r;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          recordOps(ctx, { serverId: input.serverId, channel: "ssh", action: "installNode", auditAction: "ops:install_node", status: "error", errorMessage: msg, detail: { gitUrl: input.gitUrl } });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }
      }),

    installModel: managerProc
      .input(z.object({ serverId: z.number().int(), url: z.string().max(2048), dir: z.enum(MODEL_DIRS), filename: z.string().max(255) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const r = await installModel(input.serverId, input.url, input.dir, input.filename);
          recordOps(ctx, { serverId: input.serverId, channel: "ssh", action: "installModel", auditAction: "ops:install_model", command: r.command, status: r.ok ? "success" : "error", output: r.output, detail: { dir: input.dir, filename: input.filename } });
          return r;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          recordOps(ctx, { serverId: input.serverId, channel: "ssh", action: "installModel", auditAction: "ops:install_model", status: "error", errorMessage: msg, detail: { dir: input.dir, filename: input.filename } });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }
      }),

    /** Diagnose a ComfyUI error string → human hint (missing node→plugin, missing
     *  file→directory, dimension mismatch). Reuses the canvas-side knowledge base. */
    diagnose: adminProcedure.input(z.object({ errorText: z.string().max(8000) })).query(({ input }) => {
      const hint = comfyErrorHint(input.errorText);
      return { hint: hint.trim() || "未识别到已知错误模式。可把完整报错贴到终端/AI 助手进一步排查。" };
    }),
  }),

  // ── AI 运维助手（admin only）──────────────────────────────────────────────
  ai: router({
    generate: managerProc
      .input(z.object({ serverId: z.number().int(), model: z.string().max(64), query: z.string().min(1).max(4000) }))
      .mutation(async ({ ctx, input }) => {
        await assertLLMAllowed(ctx, input.model);
        const plan = await aiGenerateOps(ctx, { model: input.model, serverId: input.serverId, userQuery: input.query });
        recordOps(ctx, {
          serverId: input.serverId, channel: "api", action: "aiGenerate", auditAction: "ops:ai_generate",
          approvedByAi: true, status: "success", command: input.query,
          detail: { model: input.model, source: plan.source, steps: plan.steps.length },
        });
        return plan;
      }),
  }),

  // ── Script library + batch run (admin only) ──────────────────────────────
  scripts: router({
    list: adminProcedure.query(() => listOpsScripts()),

    save: managerProc
      .input(z.object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(128),
        category: z.string().max(32).optional(),
        description: z.string().max(2000).optional(),
        body: z.string().min(1).max(20000),
        source: z.enum(["manual", "ai"]).default("manual"),
      }))
      .mutation(async ({ ctx, input }) => {
        const dangerous = classifyCommand(input.body).dangerous;
        if (input.id) {
          await updateOpsScript(input.id, { name: input.name, category: input.category || null, description: input.description || null, body: input.body, dangerous });
          return { id: input.id };
        }
        const id = await insertOpsScript({ name: input.name, category: input.category || null, description: input.description || null, body: input.body, dangerous, source: input.source, createdByEmail: ctx.user.email ?? null });
        return { id };
      }),

    delete: managerProc.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
      await deleteOpsScript(input.id);
      return { ok: true };
    }),

    /** Run a script across multiple servers concurrently — one ops record per
     *  server. Dangerous scripts require confirmedDangerous (red confirm). */
    run: managerProc
      .input(z.object({
        body: z.string().min(1).max(20000),
        serverIds: z.array(z.number().int()).min(1).max(32),
        confirmedDangerous: z.boolean().default(false),
        timeoutMs: z.number().int().min(1000).max(600000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const risk = classifyCommand(input.body);
        if (risk.dangerous && !input.confirmedDangerous) {
          return { blocked: true as const, dangerous: true, reasons: risk.reasons };
        }
        // Concurrency cap mirrors the stress-test mapLimit pattern.
        const results = await Promise.all(input.serverIds.map(async (serverId) => {
          try {
            const res = await sshExec(serverId, input.body, { timeoutMs: input.timeoutMs ?? 180_000 });
            recordOps(ctx, {
              serverId, channel: "ssh", action: "script", auditAction: "ops:script_run",
              command: input.body, status: res.exitCode === 0 ? "success" : "error",
              exitCode: res.exitCode, durationMs: res.durationMs, output: res.output,
              detail: { dangerous: risk.dangerous, batch: input.serverIds.length },
            });
            return { serverId, ok: res.exitCode === 0, exitCode: res.exitCode, output: res.output, timedOut: res.timedOut };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            recordOps(ctx, { serverId, channel: "ssh", action: "script", auditAction: "ops:script_run", command: input.body, status: "error", errorMessage: msg });
            return { serverId, ok: false, exitCode: -1, output: "执行失败：" + msg, timedOut: false };
          }
        }));
        return { blocked: false as const, results };
      }),
  }),

  // ── Records & settings (admin only) ───────────────────────────────────────
  records: adminProcedure.input(z.object({ serverId: z.number().int().optional(), limit: z.number().int().min(1).max(500).optional() })).query(({ input }) => listOpsRecords(input)),

  settings: router({
    get: adminProcedure.query(() => getOpsSettings()),
    set: managerProc
      .input(z.object({ globalTrustMode: z.boolean().optional(), readOnlyOpenToWhitelist: z.boolean().optional(), autoExecWhitelist: z.array(z.string()).optional() }))
      .mutation(async ({ ctx, input }) => {
        await setOpsSettings(input);
        recordOps(ctx, { channel: "api", action: "trust_toggle", auditAction: "ops:trust_toggle", status: "success", detail: input });
        return { ok: true };
      }),
  }),
});
