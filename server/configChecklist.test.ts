import { describe, it, expect } from "vitest";
import { evaluateChecklist, type ChecklistInput } from "./_core/configChecklist";

// 一个「全绿生产」基线快照，各用例只覆写关心的字段。
function base(): ChecklistInput {
  return {
    isProduction: true,
    devBypass: false,
    jwtSecretSet: true,
    databaseUrlSet: true,
    oauthUrlSet: false,
    ownerEmailFromEnv: true,
    ownerEmail: "me@example.com",
    s3: { endpoint: true, bucket: true, accessKey: true, secretKey: true, publicEndpoint: false },
    forgeConfigured: false,
    keys: {
      kie: true, kieSecret: true, poyo: true, openai: true, anthropic: false,
      higgsKey: true, higgsSecret: true, comfyBase: true, comfyCloudKey: true,
      sshSecret: true, googleId: false, googleSecret: false,
    },
    bridge: { keySet: false, keyValue: "", claudeTokenSet: false, codexApiKeySet: false, skillsOn: false, mcpConfigRaw: "", mcpConfigOk: false, mcpServerNames: [] },
    superAgent: { enabled: false, allowBash: false, permissionCmdSet: false, autoInstall: false },
    probes: { ffmpeg: true, claudeCli: false, codexCli: false, codexAuthJson: false },
    dbConf: {
      smtpHostSet: true, emailVerificationEnabled: false,
      tunnelEnabled: false, tunnelTokenSet: false, tunnelPreferQuick: false,
      selfHosted: { url: "", apiKey: "", modelIds: [] },
    },
  };
}
const find = (items: ReturnType<typeof evaluateChecklist>, id: string) => items.find((i) => i.id === id);

describe("evaluateChecklist — 核心必配项", () => {
  it("生产缺 JWT_SECRET → missing；缺 DATABASE_URL → missing", () => {
    const items = evaluateChecklist({ ...base(), jwtSecretSet: false, databaseUrlSet: false });
    expect(find(items, "core.jwt")!.status).toBe("missing");
    expect(find(items, "core.db")!.status).toBe("missing");
  });
  it("dev 内存模式 → 运行模式 warn、DB 仅 warn（内存兜底）", () => {
    const items = evaluateChecklist({ ...base(), isProduction: false, devBypass: true, databaseUrlSet: false });
    expect(find(items, "core.mode")!.status).toBe("warn");
    expect(find(items, "core.db")!.status).toBe("warn");
  });
  it("OWNER_EMAIL 未从 env 设置 → warn（提醒第三方部署改邮箱）", () => {
    const items = evaluateChecklist({ ...base(), ownerEmailFromEnv: false });
    expect(find(items, "core.owner")!.status).toBe("warn");
  });
});

describe("evaluateChecklist — 对象存储", () => {
  it("S3 四项齐 → ok", () => {
    expect(find(evaluateChecklist(base()), "storage.s3")!.status).toBe("ok");
  });
  it("S3 半配（缺 secretKey）→ warn 且指出缺哪项", () => {
    const it0 = find(evaluateChecklist({ ...base(), s3: { endpoint: true, bucket: true, accessKey: true, secretKey: false, publicEndpoint: false } }), "storage.s3")!;
    expect(it0.status).toBe("warn");
    expect(it0.detail).toContain("S3_SECRET_KEY");
  });
  it("S3 与 Forge 都没配 → missing（成片无处存）", () => {
    const items = evaluateChecklist({ ...base(), s3: { endpoint: false, bucket: false, accessKey: false, secretKey: false, publicEndpoint: false }, forgeConfigured: false });
    expect(find(items, "storage.s3")!.status).toBe("missing");
  });
  it("无 S3 但有 Forge → ok", () => {
    const items = evaluateChecklist({ ...base(), s3: { endpoint: false, bucket: false, accessKey: false, secretKey: false, publicEndpoint: false }, forgeConfigured: true });
    expect(find(items, "storage.s3")!.status).toBe("ok");
  });
});

describe("evaluateChecklist — Higgsfield 成对校验", () => {
  it("只设了 KEY → warn", () => {
    const items = evaluateChecklist({ ...base(), keys: { ...base().keys, higgsKey: true, higgsSecret: false } });
    expect(find(items, "keys.higgs")!.status).toBe("warn");
  });
});

describe("evaluateChecklist — ffmpeg 探测", () => {
  it("ffmpeg 不可用 → missing", () => {
    const items = evaluateChecklist({ ...base(), probes: { ...base().probes, ffmpeg: false } });
    expect(find(items, "dep.ffmpeg")!.status).toBe("missing");
  });
});

describe("evaluateChecklist — 订阅桥接", () => {
  it("桥接口令未设 → off，不产出桥接子项", () => {
    const items = evaluateChecklist(base());
    expect(find(items, "bridge.key")!.status).toBe("off");
    expect(find(items, "bridge.selfHosted")).toBeUndefined();
  });
  it("桥接开启但后台 Key 与服务端不一致 → warn（会 401）", () => {
    const items = evaluateChecklist({
      ...base(),
      bridge: { ...base().bridge, keySet: true, keyValue: "secret-A", claudeTokenSet: true },
      dbConf: { ...base().dbConf, selfHosted: { url: "https://x/api/claude-bridge", apiKey: "secret-B", modelIds: ["claude-local"] } },
    });
    expect(find(items, "bridge.selfHosted")!.status).toBe("warn");
  });
  it("桥接地址与 Key 都对上 → ok", () => {
    const items = evaluateChecklist({
      ...base(),
      probes: { ...base().probes, claudeCli: true },
      bridge: { ...base().bridge, keySet: true, keyValue: "same", claudeTokenSet: true },
      dbConf: { ...base().dbConf, selfHosted: { url: "http://127.0.0.1:3000/api/claude-bridge", apiKey: "same", modelIds: ["claude-local"] } },
    });
    expect(find(items, "bridge.selfHosted")!.status).toBe("ok");
  });
  it("同时设 CLAUDE_CODE_OAUTH_TOKEN 与 ANTHROPIC_API_KEY → 计费冲突 warn", () => {
    const items = evaluateChecklist({
      ...base(),
      keys: { ...base().keys, anthropic: true },
      probes: { ...base().probes, claudeCli: true },
      bridge: { ...base().bridge, keySet: true, keyValue: "k", claudeTokenSet: true },
      dbConf: { ...base().dbConf, selfHosted: { url: "http://x/api/claude-bridge", apiKey: "k", modelIds: ["claude-local"] } },
    });
    expect(find(items, "bridge.conflict")!.status).toBe("warn");
  });
  it("登记了 gpt-local 但缺 codex CLI / auth.json → 两条 warn；设了 CODEX_API_KEY → 风险 warn", () => {
    const items = evaluateChecklist({
      ...base(),
      probes: { ...base().probes, codexCli: false, codexAuthJson: false },
      bridge: { ...base().bridge, keySet: true, keyValue: "k", codexApiKeySet: true },
      dbConf: { ...base().dbConf, selfHosted: { url: "http://x/api/claude-bridge", apiKey: "k", modelIds: ["gpt-local"] } },
    });
    expect(find(items, "bridge.codexCli")!.status).toBe("warn");
    expect(find(items, "bridge.codexAuth")!.status).toBe("warn");
    expect(find(items, "bridge.codexApiKey")!.status).toBe("warn");
  });
  it("桥接开启 + 未开技能/MCP → 单条 off 提示，无风险行", () => {
    const items = evaluateChecklist({
      ...base(),
      probes: { ...base().probes, claudeCli: true },
      bridge: { ...base().bridge, keySet: true, keyValue: "k", claudeTokenSet: true },
      dbConf: { ...base().dbConf, selfHosted: { url: "http://x/api/claude-bridge", apiKey: "k", modelIds: ["claude-local"] } },
    });
    expect(find(items, "bridge.agentic")!.status).toBe("off");
    expect(find(items, "bridge.agenticRisk")).toBeUndefined();
  });
  it("开了技能 + 合法 MCP → skills ok / mcp ok / 安全提示 warn", () => {
    const items = evaluateChecklist({
      ...base(),
      probes: { ...base().probes, claudeCli: true },
      bridge: { ...base().bridge, keySet: true, keyValue: "k", claudeTokenSet: true, skillsOn: true, mcpConfigRaw: "/cfg.json", mcpConfigOk: true, mcpServerNames: ["fetch"] },
      dbConf: { ...base().dbConf, selfHosted: { url: "http://x/api/claude-bridge", apiKey: "k", modelIds: ["claude-local"] } },
    });
    expect(find(items, "bridge.skills")!.status).toBe("ok");
    expect(find(items, "bridge.mcp")!.status).toBe("ok");
    expect(find(items, "bridge.agenticRisk")!.status).toBe("warn");
  });
  it("MCP 配置读不到/解析失败 → mcp warn", () => {
    const items = evaluateChecklist({
      ...base(),
      probes: { ...base().probes, claudeCli: true },
      bridge: { ...base().bridge, keySet: true, keyValue: "k", claudeTokenSet: true, mcpConfigRaw: "/bad.json", mcpConfigOk: false, mcpServerNames: [] },
      dbConf: { ...base().dbConf, selfHosted: { url: "http://x/api/claude-bridge", apiKey: "k", modelIds: ["claude-local"] } },
    });
    expect(find(items, "bridge.mcp")!.status).toBe("warn");
  });
});

describe("evaluateChecklist — 工程智能体", () => {
  it("放行 Bash 但没配审批 → warn", () => {
    const items = evaluateChecklist({ ...base(), superAgent: { enabled: true, allowBash: true, permissionCmdSet: false, autoInstall: false } });
    expect(find(items, "sa.bash")!.status).toBe("warn");
  });
  it("未启用 → off", () => {
    expect(find(evaluateChecklist(base()), "sa.enabled")!.status).toBe("off");
  });
});

describe("evaluateChecklist — 注册邮件", () => {
  it("开了邮箱验证但没配 SMTP → warn", () => {
    const items = evaluateChecklist({ ...base(), dbConf: { ...base().dbConf, emailVerificationEnabled: true, smtpHostSet: false } });
    expect(find(items, "auth.smtp")!.status).toBe("warn");
  });
});
