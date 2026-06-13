import { sshExec } from "./sshExec";

// Docker management over SSH (the docker CLI), not dockerode — matches the
// "SSH + API dual channel" decision and avoids a heavy native dep. Every
// container reference is validated against a strict charset before it reaches
// the shell, so a malicious name can't break out of the docker subcommand.

const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
function assertContainer(name: string): void {
  if (!name || name.length > 128 || !CONTAINER_RE.test(name)) {
    throw new Error("非法容器名/ID");
  }
}

export interface DockerContainer {
  id: string;
  image: string;
  name: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
}

/** Parse `docker ... --format '{{json .}}'` output (one JSON object per line). */
function parseJsonLines<T = Record<string, string>>(out: string): T[] {
  const rows: T[] = [];
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try { rows.push(JSON.parse(t) as T); } catch { /* skip malformed */ }
  }
  return rows;
}

/** List all containers (running + stopped). */
export async function dockerPs(serverId: number): Promise<DockerContainer[]> {
  const res = await sshExec(serverId, "docker ps -a --no-trunc --format '{{json .}}'", { timeoutMs: 30_000 });
  if (res.exitCode !== 0) throw new Error(res.output.trim() || "docker ps 失败（退出码 " + res.exitCode + "）");
  return parseJsonLines(res.output).map((r) => ({
    id: (r.ID ?? "").slice(0, 12),
    image: r.Image ?? "",
    name: r.Names ?? r.Name ?? "",
    status: r.Status ?? "",
    state: r.State ?? "",
    ports: r.Ports ?? "",
    createdAt: r.CreatedAt ?? r.RunningFor ?? "",
  }));
}

export interface DockerStat { name: string; cpu: string; mem: string; memPerc: string; }

/** One-shot resource stats for running containers. */
export async function dockerStats(serverId: number): Promise<DockerStat[]> {
  const res = await sshExec(serverId, "docker stats --no-stream --format '{{json .}}'", { timeoutMs: 30_000 });
  if (res.exitCode !== 0) return [];
  return parseJsonLines(res.output).map((r) => ({
    name: r.Name ?? "", cpu: r.CPUPerc ?? "", mem: r.MemUsage ?? "", memPerc: r.MemPerc ?? "",
  }));
}

/** Tail container logs. `tail` is clamped server-side; container is validated. */
export async function dockerLogs(serverId: number, container: string, tail = 200): Promise<string> {
  assertContainer(container);
  const n = Math.min(Math.max(Math.floor(tail) || 200, 1), 5000);
  const res = await sshExec(serverId, `docker logs --tail ${n} --timestamps ${container} 2>&1`, { timeoutMs: 30_000 });
  return res.output;
}

export type DockerAction = "start" | "stop" | "restart";

/** Lifecycle action on a container (start/stop/restart). Not destructive — `rm`
 *  and prune are intentionally excluded here (they hit the dangerous-command
 *  path via the generic exec panel instead). */
export async function dockerAction(serverId: number, container: string, action: DockerAction): Promise<{ ok: boolean; output: string }> {
  assertContainer(container);
  if (!["start", "stop", "restart"].includes(action)) throw new Error("不支持的操作");
  const res = await sshExec(serverId, `docker ${action} ${container}`, { timeoutMs: 60_000 });
  return { ok: res.exitCode === 0, output: res.output.trim() };
}

/** docker inspect (truncated) for a single container — for a details drawer. */
export async function dockerInspect(serverId: number, container: string): Promise<string> {
  assertContainer(container);
  const res = await sshExec(serverId, `docker inspect ${container}`, { timeoutMs: 30_000 });
  return res.output.slice(0, 100_000);
}
