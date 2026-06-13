import { getConnectedClient } from "./sshPool";

// One-shot SSH command execution. Streams stdout/stderr, returns exit code +
// captured output (tail-bounded). Mirrors the selfUpdate.ts "collect output,
// resolve exit code" shape but over an ssh2 exec channel instead of local spawn.

const OUTPUT_CAP = 200_000; // chars; protect memory on chatty commands

export interface ExecResult {
  exitCode: number;
  output: string;     // combined stdout+stderr (tail-capped)
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOpts {
  timeoutMs?: number;
  /** Called with each output chunk for live streaming (e.g. to socket.io). */
  onChunk?: (chunk: string) => void;
}

export async function sshExec(serverId: number, command: string, opts: ExecOpts = {}): Promise<ExecResult> {
  const client = await getConnectedClient(serverId);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const started = Date.now();
  return new Promise<ExecResult>((resolve, reject) => {
    client.exec(command, { pty: false }, (err, channel) => {
      if (err) { reject(err); return; }
      let output = "";
      let timedOut = false;
      const append = (buf: Buffer) => {
        const s = buf.toString("utf8");
        opts.onChunk?.(s);
        if (output.length < OUTPUT_CAP) output += s;
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try { channel.close(); } catch { /* ignore */ }
      }, timeoutMs);
      timer.unref?.();
      let exitCode = -1;
      channel.on("data", append);
      channel.stderr.on("data", append);
      channel.on("exit", (code: number | null) => { if (code != null) exitCode = code; });
      channel.on("close", () => {
        clearTimeout(timer);
        // tail-cap: keep the most recent OUTPUT_CAP chars
        const capped = output.length > OUTPUT_CAP ? output.slice(-OUTPUT_CAP) : output;
        resolve({ exitCode, output: capped, timedOut, durationMs: Date.now() - started });
      });
    });
  });
}

/** Convenience: last N lines of output, for storing as a record's outputTail. */
export function tailLines(output: string, n = 40): string {
  const lines = output.split(/\r?\n/);
  return lines.slice(-n).join("\n").slice(-4000);
}
