import { describe, it, expect, beforeAll } from "vitest";
import { classifyCommand, mayAutoExecute } from "./_core/ops/commandPolicy";

describe("commandPolicy.classifyCommand", () => {
  it("flags rm -rf as dangerous", () => {
    const r = classifyCommand("rm -rf /var/log/comfy");
    expect(r.dangerous).toBe(true);
    expect(r.autoExecEligible).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("flags mkfs / dd-to-device / reboot / fork bomb", () => {
    expect(classifyCommand("mkfs.ext4 /dev/sdb").dangerous).toBe(true);
    expect(classifyCommand("dd if=/dev/zero of=/dev/sda").dangerous).toBe(true);
    expect(classifyCommand("sudo reboot").dangerous).toBe(true);
    expect(classifyCommand(":(){ :|:& };:").dangerous).toBe(true);
    expect(classifyCommand("docker system prune -af").dangerous).toBe(true);
  });

  it("treats read-only commands as safe + auto-exec eligible", () => {
    for (const c of ["nvidia-smi", "df -h", "free -m", "docker ps", "uptime"]) {
      const r = classifyCommand(c);
      expect(r.dangerous).toBe(false);
      expect(r.autoExecEligible).toBe(true);
    }
  });

  it("non-whitelisted but harmless command is not auto-exec eligible", () => {
    const r = classifyCommand("pip install some-package");
    expect(r.dangerous).toBe(false);
    expect(r.autoExecEligible).toBe(false);
  });

  it("multi-line: any dangerous line taints the whole block", () => {
    const r = classifyCommand("df -h\nrm -rf /tmp/x");
    expect(r.dangerous).toBe(true);
    expect(r.autoExecEligible).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const r = classifyCommand("# just checking\n\nnvidia-smi");
    expect(r.autoExecEligible).toBe(true);
  });
});

describe("commandPolicy.mayAutoExecute", () => {
  it("only auto-executes safe commands when trustMode on and not AI-generated", () => {
    expect(mayAutoExecute("df -h", { trustMode: true, aiGenerated: false })).toBe(true);
    expect(mayAutoExecute("df -h", { trustMode: false, aiGenerated: false })).toBe(false);
    expect(mayAutoExecute("df -h", { trustMode: true, aiGenerated: true })).toBe(false);
    expect(mayAutoExecute("rm -rf /x", { trustMode: true, aiGenerated: false })).toBe(false);
    expect(mayAutoExecute("pip install x", { trustMode: true, aiGenerated: false })).toBe(false);
  });
});

describe("modelOps validators (injection guard)", () => {
  it("accepts clean git/model/download inputs", async () => {
    const { isValidGitUrl, isValidModelFilename, isValidDownloadUrl } = await import("./_core/ops/modelOps");
    expect(isValidGitUrl("https://github.com/ltdrdata/ComfyUI-Manager.git")).toBe(true);
    expect(isValidGitUrl("https://github.com/cubiq/ComfyUI_IPAdapter_plus")).toBe(true);
    expect(isValidModelFilename("flux1-dev.safetensors")).toBe(true);
    expect(isValidModelFilename("model.gguf")).toBe(true);
    expect(isValidDownloadUrl("https://huggingface.co/x/resolve/main/m.safetensors")).toBe(true);
  });

  it("rejects shell-injection / scheme / extension violations", async () => {
    const { isValidGitUrl, isValidModelFilename, isValidDownloadUrl } = await import("./_core/ops/modelOps");
    expect(isValidGitUrl("https://x.com/r.git; rm -rf /")).toBe(false);
    expect(isValidGitUrl("git@github.com:x/y.git")).toBe(false); // ssh scheme not allowed
    expect(isValidGitUrl("https://x.com/$(whoami)")).toBe(false);
    expect(isValidModelFilename("a.safetensors; rm -rf /")).toBe(false);
    expect(isValidModelFilename("../../etc/passwd")).toBe(false);
    expect(isValidModelFilename("notamodel.txt")).toBe(false);
    expect(isValidDownloadUrl("http://x.com/m && reboot")).toBe(false);
    expect(isValidDownloadUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("aiOps.sanitizeAiSteps (danger override + hallucination guard)", () => {
  it("forces dangerous=true even when the LLM claims a destructive cmd is safe", async () => {
    const { sanitizeAiSteps } = await import("./_core/ops/aiOps");
    const steps = sanitizeAiSteps({ steps: [{ explain: "清理", command: "rm -rf /opt/ComfyUI/output", channel: "ssh", dangerous: false }] });
    expect(steps).toHaveLength(1);
    expect(steps[0].dangerous).toBe(true);
  });

  it("drops steps with no command, clamps channel, caps count", async () => {
    const { sanitizeAiSteps } = await import("./_core/ops/aiOps");
    const steps = sanitizeAiSteps({ steps: [
      { explain: "ok", command: "nvidia-smi", channel: "weird" },
      { explain: "empty", command: "" },
      { explain: "nocmd" },
      null,
      "garbage",
    ] });
    expect(steps).toHaveLength(1);
    expect(steps[0].channel).toBe("ssh"); // unknown channel clamped to ssh
    expect(steps[0].dangerous).toBe(false);
  });

  it("returns empty for non-array steps", async () => {
    const { sanitizeAiSteps } = await import("./_core/ops/aiOps");
    expect(sanitizeAiSteps({ steps: "not-an-array" })).toEqual([]);
    expect(sanitizeAiSteps({})).toEqual([]);
  });
});

describe("sshCrypto round-trip", () => {
  beforeAll(() => { process.env.SSH_KEY_SECRET = "test-ssh-secret-12345"; });

  it("encrypts and decrypts back to plaintext, with random ciphertext", async () => {
    const { encryptSshSecret, decryptSshSecret, sshSecretLast4, isSshCryptoConfigured } = await import("./_core/ops/sshCrypto");
    expect(isSshCryptoConfigured()).toBe(true);
    const plain = "hunter2-private-key-or-password";
    const a = encryptSshSecret(plain);
    const b = encryptSshSecret(plain);
    expect(a).not.toBe(b); // random salt/iv
    expect(a.startsWith("v1:")).toBe(true);
    expect(decryptSshSecret(a)).toBe(plain);
    expect(decryptSshSecret(b)).toBe(plain);
    expect(sshSecretLast4(plain)).toBe("word");
  });

  it("rejects malformed ciphertext", async () => {
    const { decryptSshSecret } = await import("./_core/ops/sshCrypto");
    expect(() => decryptSshSecret("not-a-valid-blob")).toThrow();
  });
});
