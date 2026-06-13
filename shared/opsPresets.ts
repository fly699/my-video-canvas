// 内置运维配方库（built-in ops presets）。把常用 Linux / Python / Docker / ComfyUI
// 运维操作做成「点选 + 填空」的配方，让不熟命令行的用户也能安全套用。配方在前端
// 把 {{占位符}} 替换为用户填写的值生成最终命令，再走 comfyOps.exec 执行——执行侧仍由
// 服务端 adminProcedure + classifyCommand 危险检测兜底。
//
// 安全：参数值按类型校验（见 validateParamValue），杜绝把 shell 元字符塞进命令。

export type OpsParamType = "text" | "number" | "path" | "container" | "service" | "url" | "filename" | "host" | "keyword" | "port" | "pid";

export interface OpsPresetParam {
  key: string;
  label: string;
  type: OpsParamType;
  placeholder?: string;
  default?: string;
}

export interface OpsPreset {
  id: string;
  category: string;
  title: string;
  desc: string;            // 人话：做什么 / 何时用
  command: string;         // 含 {{key}} 占位符
  dangerous?: boolean;
  interactive?: boolean;   // 需在「终端」运行（如持续刷新），而非一次性执行
  params?: OpsPresetParam[];
}

export interface OpsPresetCategory { id: string; label: string; icon: string; }

export const OPS_PRESET_CATEGORIES: OpsPresetCategory[] = [
  { id: "comfy", label: "ComfyUI 服务", icon: "🎨" },
  { id: "gpu", label: "GPU / 显存", icon: "🖥️" },
  { id: "disk", label: "磁盘清理", icon: "🧹" },
  { id: "docker", label: "Docker", icon: "🐳" },
  { id: "system", label: "系统监控", icon: "📊" },
  { id: "process", label: "进程管理", icon: "⚙️" },
  { id: "network", label: "网络排查", icon: "🌐" },
  { id: "python", label: "Python 环境", icon: "🐍" },
  { id: "logs", label: "日志排查", icon: "📜" },
  { id: "models", label: "模型/文件", icon: "📦" },
];

// 常用自定义节点清单：让用户在「模型/节点」页一键填入 git 地址安装，无需知道仓库
// 地址。仅收录广泛使用、活跃维护的插件。
export interface PopularNode { name: string; desc: string; gitUrl: string; }
export const POPULAR_COMFY_NODES: PopularNode[] = [
  { name: "ComfyUI-Manager", desc: "节点/模型管理器（必装，图形化装插件）", gitUrl: "https://github.com/ltdrdata/ComfyUI-Manager" },
  { name: "ComfyUI_IPAdapter_plus", desc: "IPAdapter 人脸/风格参考", gitUrl: "https://github.com/cubiq/ComfyUI_IPAdapter_plus" },
  { name: "ComfyUI-VideoHelperSuite", desc: "视频合成/导出（VHS 节点）", gitUrl: "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite" },
  { name: "ComfyUI-AnimateDiff-Evolved", desc: "AnimateDiff 视频生成", gitUrl: "https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved" },
  { name: "ComfyUI-Advanced-ControlNet", desc: "进阶 ControlNet 控制", gitUrl: "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet" },
  { name: "comfyui_controlnet_aux", desc: "ControlNet 预处理器（姿态/深度/线稿）", gitUrl: "https://github.com/Fannovel16/comfyui_controlnet_aux" },
  { name: "ComfyUI-Impact-Pack", desc: "人脸修复/细节增强/检测", gitUrl: "https://github.com/ltdrdata/ComfyUI-Impact-Pack" },
  { name: "ComfyUI-Custom-Scripts", desc: "实用增强（预览/自动补全等）", gitUrl: "https://github.com/pythongosssss/ComfyUI-Custom-Scripts" },
  { name: "ComfyUI-GGUF", desc: "GGUF 量化模型加载（省显存）", gitUrl: "https://github.com/city96/ComfyUI-GGUF" },
  { name: "ComfyUI-WanVideoWrapper", desc: "Wan 视频模型封装", gitUrl: "https://github.com/kijai/ComfyUI-WanVideoWrapper" },
  { name: "ComfyUI-KJNodes", desc: "KJ 工具节点合集", gitUrl: "https://github.com/kijai/ComfyUI-KJNodes" },
  { name: "rgthree-comfy", desc: "工作流增强（组节点/连线优化）", gitUrl: "https://github.com/rgthree/rgthree-comfy" },
  { name: "was-node-suite-comfyui", desc: "WAS 超全工具节点合集", gitUrl: "https://github.com/WASasquatch/was-node-suite-comfyui" },
  { name: "ComfyUI-Frame-Interpolation", desc: "补帧（提升视频帧率）", gitUrl: "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation" },
  { name: "ComfyUI_essentials", desc: "常用基础节点补全", gitUrl: "https://github.com/cubiq/ComfyUI_essentials" },
];

// 常用参数定义（复用）
const P_COMFY: OpsPresetParam = { key: "comfyPath", label: "ComfyUI 路径", type: "path", placeholder: "/opt/ComfyUI", default: "/opt/ComfyUI" };
const P_CONTAINER: OpsPresetParam = { key: "container", label: "容器名", type: "container", placeholder: "comfyui" };
const P_SERVICE: OpsPresetParam = { key: "service", label: "服务名", type: "service", placeholder: "comfyui", default: "comfyui" };
const P_DAYS: OpsPresetParam = { key: "days", label: "保留天数（删除更早的）", type: "number", placeholder: "7", default: "7" };
const P_PORT: OpsPresetParam = { key: "port", label: "端口", type: "port", placeholder: "8188", default: "8188" };

export const OPS_PRESETS: OpsPreset[] = [
  // ── ComfyUI 服务 ──
  { id: "comfy_restart_docker", category: "comfy", title: "重启 ComfyUI（Docker）", desc: "容器部署时一键重启 ComfyUI 容器，加载新模型/节点或卡死时用。", command: "docker restart {{container}}", params: [P_CONTAINER] },
  { id: "comfy_restart_systemd", category: "comfy", title: "重启 ComfyUI（systemd）", desc: "以 systemd 服务运行时重启 ComfyUI。", command: "sudo systemctl restart {{service}}", params: [P_SERVICE] },
  { id: "comfy_stop_docker", category: "comfy", title: "停止 ComfyUI（Docker）", desc: "临时停掉容器（省显存/维护）。", command: "docker stop {{container}}", params: [P_CONTAINER] },
  { id: "comfy_start_docker", category: "comfy", title: "启动 ComfyUI（Docker）", desc: "启动已停止的容器。", command: "docker start {{container}}", params: [P_CONTAINER] },
  { id: "comfy_logs_docker", category: "comfy", title: "看 ComfyUI 日志（Docker）", desc: "查看容器最近 200 行日志，排查报错。", command: "docker logs --tail 200 --timestamps {{container}}", params: [P_CONTAINER] },
  { id: "comfy_logs_systemd", category: "comfy", title: "看 ComfyUI 日志（systemd）", desc: "查看 systemd 服务最近 200 行日志。", command: "journalctl -u {{service}} -n 200 --no-pager", params: [P_SERVICE] },
  { id: "comfy_ps", category: "comfy", title: "ComfyUI 是否在运行", desc: "查找 ComfyUI 进程，确认有没有在跑。", command: "ps aux | grep -i comfy | grep -v grep" },
  { id: "comfy_update", category: "comfy", title: "更新 ComfyUI 本体", desc: "git 拉取 ComfyUI 最新代码（更新后需重启）。", command: "cd {{comfyPath}} && git pull", params: [P_COMFY] },
  { id: "comfy_update_nodes", category: "comfy", title: "更新全部自定义节点", desc: "逐个 git pull 所有 custom_nodes 插件（更新后需重启）。", command: "cd {{comfyPath}}/custom_nodes && for d in */; do echo \"== $d ==\"; (cd \"$d\" && git pull 2>&1 || true); done", params: [P_COMFY] },
  { id: "comfy_reqs", category: "comfy", title: "重装 ComfyUI 依赖", desc: "重新安装 requirements.txt 里的 Python 依赖（缺包/报 import error 时用）。", command: "cd {{comfyPath}} && pip install -r requirements.txt", params: [P_COMFY] },
  { id: "comfy_port_check", category: "comfy", title: "ComfyUI 端口是否通", desc: "请求 /system_stats，返回 200 即服务正常。", command: "curl -sS -o /dev/null -w 'HTTP %{http_code}\\n' http://localhost:{{port}}/system_stats", params: [P_PORT] },

  // ── GPU / 显存 ──
  { id: "gpu_status", category: "gpu", title: "查看 GPU 状态", desc: "显示所有 GPU 的利用率、显存、温度、跑着的进程。", command: "nvidia-smi" },
  { id: "gpu_watch", category: "gpu", title: "实时 GPU 监控", desc: "每秒刷新 GPU 状态（在终端里运行，Ctrl+C 退出）。", command: "nvidia-smi -l 1", interactive: true },
  { id: "gpu_apps", category: "gpu", title: "谁在占用显存", desc: "列出占用显存的进程（PID/名称/占用量）。", command: "nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv" },
  { id: "gpu_temp", category: "gpu", title: "GPU 温度/功耗", desc: "查看温度、功耗、利用率，判断是否过热。", command: "nvidia-smi --query-gpu=index,temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total --format=csv" },
  { id: "gpu_kill_python", category: "gpu", title: "强杀占显存的 Python 进程", desc: "杀掉所有占用 GPU 的 python 进程以释放显存（会中断正在跑的任务！）。", command: "nvidia-smi --query-compute-apps=pid --format=csv,noheader | xargs -r kill -9", dangerous: true },

  // ── 磁盘清理 ──
  { id: "disk_usage", category: "disk", title: "查看磁盘占用", desc: "各分区已用/可用空间，先看哪块盘满了。", command: "df -h" },
  { id: "disk_big_dirs", category: "disk", title: "找出大目录", desc: "列出指定路径下最占空间的前 20 个子目录。", command: "du -h {{path}} --max-depth=1 2>/dev/null | sort -hr | head -20", params: [{ key: "path", label: "要排查的路径", type: "path", placeholder: "/", default: "/" }] },
  { id: "disk_comfy_output", category: "disk", title: "清理 ComfyUI 旧输出", desc: "删除 output 目录里超过 N 天的文件，释放空间。", command: "find {{comfyPath}}/output -type f -mtime +{{days}} -print -delete", dangerous: true, params: [P_COMFY, P_DAYS] },
  { id: "disk_comfy_temp", category: "disk", title: "清理 ComfyUI 临时文件", desc: "清空 temp 临时目录（安全，重启后自动重建）。", command: "rm -rf {{comfyPath}}/temp/* {{comfyPath}}/input/clipspace* 2>/dev/null; echo done", dangerous: true, params: [P_COMFY] },
  { id: "disk_pip_cache", category: "disk", title: "清理 pip 缓存", desc: "清空 pip 下载缓存，释放空间（安全）。", command: "pip cache purge" },
  { id: "disk_apt_cache", category: "disk", title: "清理 apt 缓存", desc: "清理已下载的 apt 安装包缓存（安全）。", command: "sudo apt-get clean" },
  { id: "disk_docker_images", category: "disk", title: "清理未使用的 Docker 镜像", desc: "删除悬空/未被容器使用的镜像，释放空间。", command: "docker image prune -f", dangerous: true },
  { id: "disk_docker_all", category: "disk", title: "Docker 全面清理", desc: "清理未用的容器/网络/镜像/构建缓存（不动数据卷）。", command: "docker system prune -f", dangerous: true },

  // ── Docker ──
  { id: "docker_ps", category: "docker", title: "容器列表", desc: "列出全部容器（含已停止）及状态。", command: "docker ps -a" },
  { id: "docker_stats", category: "docker", title: "容器资源占用", desc: "各容器实时 CPU/内存占用（一次快照）。", command: "docker stats --no-stream" },
  { id: "docker_df", category: "docker", title: "Docker 磁盘占用", desc: "镜像/容器/卷各占多少空间。", command: "docker system df" },
  { id: "docker_gpu", category: "docker", title: "容器内看 GPU", desc: "在容器里跑 nvidia-smi，确认容器能用 GPU。", command: "docker exec {{container}} nvidia-smi", params: [P_CONTAINER] },
  { id: "docker_images", category: "docker", title: "镜像列表", desc: "本机所有 Docker 镜像及大小。", command: "docker images" },
  { id: "docker_exec_bash", category: "docker", title: "进入容器看目录", desc: "列出容器内某目录内容（排查文件用）。", command: "docker exec {{container}} ls -lh {{path}}", params: [P_CONTAINER, { key: "path", label: "容器内路径", type: "path", placeholder: "/app", default: "/" }] },

  // ── 系统监控 ──
  { id: "sys_overview", category: "system", title: "系统总览", desc: "一次看全：负载 + 内存 + 磁盘 + GPU。最常用的体检命令。", command: "echo '== 负载 =='; uptime; echo; echo '== 内存 =='; free -h; echo; echo '== 磁盘 =='; df -h; echo; echo '== GPU =='; nvidia-smi 2>/dev/null || echo '(无 GPU)'" },
  { id: "sys_mem", category: "system", title: "内存使用", desc: "查看内存与 swap 使用情况。", command: "free -h" },
  { id: "sys_load", category: "system", title: "CPU 负载", desc: "系统负载与运行时长。", command: "uptime" },
  { id: "sys_top", category: "system", title: "资源占用 top", desc: "当前最占资源的进程快照。", command: "top -bn1 | head -20" },
  { id: "sys_ports", category: "system", title: "端口监听情况", desc: "哪些端口在被监听、被谁占用。", command: "ss -ltnp 2>/dev/null || netstat -tlnp" },
  { id: "sys_port_who", category: "system", title: "谁占用了某端口", desc: "查指定端口被哪个进程占用。", command: "lsof -i :{{port}} 2>/dev/null || ss -ltnp 'sport = :{{port}}'", params: [P_PORT] },

  // ── 进程管理 ──
  { id: "proc_find", category: "process", title: "查找进程", desc: "按关键词查找进程（看 PID/占用）。", command: "ps aux | grep {{keyword}} | grep -v grep", params: [{ key: "keyword", label: "关键词", type: "keyword", placeholder: "python" }] },
  { id: "proc_top_mem", category: "process", title: "最耗内存的进程", desc: "内存占用前 10 的进程。", command: "ps aux --sort=-%mem | head -11" },
  { id: "proc_top_cpu", category: "process", title: "最耗 CPU 的进程", desc: "CPU 占用前 10 的进程。", command: "ps aux --sort=-%cpu | head -11" },
  { id: "proc_kill_name", category: "process", title: "按名称杀进程", desc: "杀掉名字匹配关键词的进程（谨慎，会中断对应程序）。", command: "pkill -f {{keyword}}", dangerous: true, params: [{ key: "keyword", label: "进程关键词", type: "keyword", placeholder: "" }] },
  { id: "proc_kill_pid", category: "process", title: "按 PID 杀进程", desc: "强制结束指定 PID 的进程。", command: "kill -9 {{pid}}", dangerous: true, params: [{ key: "pid", label: "进程 PID", type: "pid", placeholder: "12345" }] },

  // ── 网络排查 ──
  { id: "net_ping", category: "network", title: "测试网络连通", desc: "ping 指定主机/IP，看通不通、延迟多少。", command: "ping -c 4 {{host}}", params: [{ key: "host", label: "主机/IP", type: "host", placeholder: "8.8.8.8", default: "8.8.8.8" }] },
  { id: "net_pubip", category: "network", title: "查看公网 IP", desc: "本机出口公网 IP 地址。", command: "curl -s ifconfig.me || curl -s ip.sb" },
  { id: "net_dns", category: "network", title: "DNS 解析", desc: "解析域名到 IP，排查域名问题。", command: "nslookup {{host}} 2>/dev/null || getent hosts {{host}}", params: [{ key: "host", label: "域名", type: "host", placeholder: "huggingface.co" }] },
  { id: "net_curl", category: "network", title: "测试 URL 可达", desc: "请求一个 URL 看返回码与耗时。", command: "curl -sS -o /dev/null -w 'HTTP %{http_code} · %{time_total}s\\n' {{url}}", params: [{ key: "url", label: "URL", type: "url", placeholder: "https://huggingface.co" }] },

  // ── Python 环境 ──
  { id: "py_version", category: "python", title: "Python 版本", desc: "查看 python3 版本。", command: "python3 --version && pip --version" },
  { id: "py_list", category: "python", title: "已安装的包", desc: "列出当前环境所有 pip 包。", command: "pip list" },
  { id: "py_show", category: "python", title: "查某包版本", desc: "查看指定包的版本与依赖。", command: "pip show {{package}}", params: [{ key: "package", label: "包名", type: "keyword", placeholder: "torch" }] },
  { id: "py_install", category: "python", title: "安装 Python 包", desc: "pip 安装指定包（装节点依赖时用）。", command: "pip install {{package}}", params: [{ key: "package", label: "包名（可带版本）", type: "text", placeholder: "opencv-python" }] },
  { id: "py_torch_cuda", category: "python", title: "检查 PyTorch 是否能用 GPU", desc: "确认 torch 能识别 CUDA（出 True 才正常）。", command: "python3 -c 'import torch; print(\"CUDA可用:\", torch.cuda.is_available(), \"| 设备数:\", torch.cuda.device_count())'" },

  // ── 日志排查 ──
  { id: "log_err", category: "logs", title: "系统最近错误日志", desc: "看系统级 error 日志，排查崩溃。", command: "journalctl -p err -n 100 --no-pager 2>/dev/null || tail -100 /var/log/syslog" },
  { id: "log_dmesg", category: "logs", title: "内核/硬件日志", desc: "dmesg 末尾，看硬件/驱动/OOM 报错。", command: "dmesg 2>/dev/null | tail -50 || sudo dmesg | tail -50" },
  { id: "log_oom", category: "logs", title: "查内存溢出（OOM）", desc: "查是否有进程因内存不足被系统杀掉。", command: "dmesg 2>/dev/null | grep -i 'killed process' | tail -20 || echo '未发现 OOM 记录'" },
  { id: "log_service", category: "logs", title: "某服务日志", desc: "查看指定 systemd 服务最近日志。", command: "journalctl -u {{service}} -n 200 --no-pager", params: [{ key: "service", label: "服务名", type: "service", placeholder: "docker" }] },

  // ── 模型/文件 ──
  { id: "mdl_ckpt", category: "models", title: "列出 Checkpoint 模型", desc: "查看 checkpoints 目录里的模型文件及大小。", command: "ls -lh {{comfyPath}}/models/checkpoints", params: [P_COMFY] },
  { id: "mdl_lora", category: "models", title: "列出 LoRA 模型", desc: "查看 loras 目录里的 LoRA 文件。", command: "ls -lh {{comfyPath}}/models/loras", params: [P_COMFY] },
  { id: "mdl_usage", category: "models", title: "模型各目录占用", desc: "models 下各子目录占多少空间。", command: "du -sh {{comfyPath}}/models/* 2>/dev/null | sort -hr", params: [P_COMFY] },
  { id: "mdl_recent", category: "models", title: "最近新增的模型", desc: "找出 7 天内新增/修改的模型文件。", command: "find {{comfyPath}}/models -type f -mtime -7 -printf '%TY-%Tm-%Td %p\\n' 2>/dev/null | sort -r | head -30", params: [P_COMFY] },
  { id: "mdl_download", category: "models", title: "下载模型到 Checkpoints", desc: "把一个直链模型下载到 checkpoints 目录。", command: "wget -c -O {{comfyPath}}/models/checkpoints/{{filename}} {{url}}", params: [P_COMFY, { key: "filename", label: "保存文件名", type: "filename", placeholder: "model.safetensors" }, { key: "url", label: "下载直链", type: "url", placeholder: "https://…/model.safetensors" }] },
];

// 参数值校验：按类型限制字符，阻断把 shell 元字符塞进命令。
const PARAM_RE: Record<OpsParamType, RegExp> = {
  text: /^[\w.\-]+$/,
  number: /^\d{1,9}$/,
  path: /^[\w./\-]+$/,
  container: /^[a-zA-Z0-9][\w.\-]*$/,
  service: /^[\w.@\-]+$/,
  url: /^https?:\/\/[\w.\-]+(:\d+)?\/[\w.\-/%?=&:@~+]*$/,
  filename: /^[\w][\w.\-]*\.[a-zA-Z0-9]+$/,
  host: /^[\w.\-]+$/,
  keyword: /^[\w.\-]+$/,
  port: /^\d{1,5}$/,
  pid: /^\d{1,7}$/,
};

export function validateParamValue(type: OpsParamType, value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 512) return false;
  return PARAM_RE[type].test(v);
}

/** Fill a preset's {{key}} placeholders with validated values. Throws if any
 *  required param is missing or fails its type validation (injection guard). */
export function fillPreset(preset: OpsPreset, values: Record<string, string>): string {
  let cmd = preset.command;
  for (const p of preset.params ?? []) {
    const raw = (values[p.key] ?? p.default ?? "").trim();
    if (!raw) throw new Error(`请填写「${p.label}」`);
    if (!validateParamValue(p.type, raw)) throw new Error(`「${p.label}」格式不合法（含非法字符）`);
    cmd = cmd.split(`{{${p.key}}}`).join(raw);
  }
  return cmd;
}
