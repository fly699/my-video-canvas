import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import {
  listOpsServers, getOpsServer, insertOpsServer, updateOpsServer, deleteOpsServer,
  listOpsRecords, getOpsSettings, setOpsSettings,
} from "../db";
import { encryptSshSecret, decryptSshSecret, sshSecretLast4, isSshCryptoConfigured } from "../_core/ops/sshCrypto";
import { testConnection, dropClient, isValidSshHost } from "../_core/ops/sshPool";
import { sshExec } from "../_core/ops/sshExec";
import { classifyCommand, mayAutoExecute } from "../_core/ops/commandPolicy";
import { recordOps } from "../_core/ops/opsRecords";
import { assertComfyuiAllowed } from "../_core/whitelist";
import { fetchComfyServerStatus } from "../_core/comfyui";
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

    create: adminProcedure.input(serverInput).mutation(async ({ ctx, input }) => {
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

    update: adminProcedure.input(serverInput.partial().extend({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
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

    delete: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
      await deleteOpsServer(input.id);
      dropClient(input.id);
      recordOps(ctx, { serverId: input.id, channel: "ssh", action: "server_delete", auditAction: "ops:server_delete", status: "success" });
      return { ok: true };
    }),

    testConnection: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
      const server = await getOpsServer(input.id);
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });
      return testConnection(server);
    }),
  }),

  // ── Dashboard (read-only, whitelist-gated) ────────────────────────────────
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") await assertComfyuiAllowed(ctx);
    const servers = await listOpsServers();
    const out = await Promise.all(servers.map(async (s) => {
      const base = { id: s.id, name: s.name, deployForm: s.deployForm, enabled: s.enabled, comfyBaseUrl: s.comfyBaseUrl, sshHost: s.sshHost };
      if (!s.comfyBaseUrl || !s.enabled) return { ...base, status: null };
      const status = await fetchComfyServerStatus(s.comfyBaseUrl).catch(() => null);
      return { ...base, status };
    }));
    return out;
  }),

  // ── Quick command exec (admin only) ───────────────────────────────────────
  exec: adminProcedure
    .input(z.object({
      serverId: z.number().int(),
      command: z.string().min(1).max(8000),
      /** Caller acknowledged the danger (red confirm) for this run. */
      confirmedDangerous: z.boolean().default(false),
      timeoutMs: z.number().int().min(1000).max(600000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const server = await getOpsServer(input.serverId);
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });
      const risk = classifyCommand(input.command);
      if (risk.dangerous && !input.confirmedDangerous) {
        return { blocked: true as const, dangerous: true, reasons: risk.reasons };
      }
      const auto = mayAutoExecute(input.command, { trustMode: server.trustMode, aiGenerated: false });
      try {
        const res = await sshExec(input.serverId, input.command, { timeoutMs: input.timeoutMs });
        recordOps(ctx, {
          serverId: input.serverId, channel: "ssh", action: "exec", auditAction: "ops:exec",
          command: input.command, autoExecuted: auto, status: res.exitCode === 0 ? "success" : "error",
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

  // ── Records & settings (admin only) ───────────────────────────────────────
  records: adminProcedure.input(z.object({ serverId: z.number().int().optional(), limit: z.number().int().max(500).optional() })).query(({ input }) => listOpsRecords(input)),

  settings: router({
    get: adminProcedure.query(() => getOpsSettings()),
    set: adminProcedure
      .input(z.object({ globalTrustMode: z.boolean().optional(), readOnlyOpenToWhitelist: z.boolean().optional(), autoExecWhitelist: z.array(z.string()).optional() }))
      .mutation(async ({ ctx, input }) => {
        await setOpsSettings(input);
        recordOps(ctx, { channel: "api", action: "trust_toggle", auditAction: "ops:trust_toggle", status: "success", detail: input });
        return { ok: true };
      }),
  }),
});
