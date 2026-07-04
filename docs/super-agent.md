# 超级智能体（工程智能体）· 运维与架构说明

画布内的 `super_agent`（「工程智能体」）节点提供两种能力，均**服务端执行 + socket 流式活动日志 + 全量审计**：

| 模式 | 能力 | 默认 | 权限 |
|---|---|---|---|
| **ComfyUI 工作流** | 一句话 → 自动写 ComfyUI API 工作流 → 校验 → 真机运行 → 读报错 → 修正，直到调通，一键写回 `comfyui_workflow` 节点 | **开箱可用** | 管理员 **L3+** |
| **代码任务** | 无头 Claude Code 在一次性隔离工作区跑编码任务（读日志定位、写修复、批处理等） | **默认关闭** | 超级管理员 **L4** + env 开关 |

两种模式都**不接触生产文件/密钥**：ComfyUI 模式全程 HTTP（`/object_info`、`/prompt`、`/history`）+ LLM，与操作系统无关；代码任务在专用临时目录运行。

---

## 一、ComfyUI 工作流模式（无需配置）

节点里选「ComfyUI 工作流」→ 填工程任务 + 目标 ComfyUI 服务器（留空用服务端 `COMFYUI_BASE_URL`）→ 运行。

- 服务端跑「author → validate → execute → 读错 → 修正」闭环（`server/_core/superAgent/comfyAgent.ts`），工具由现有 `comfyui.ts` 过程兑现。
- 需 LLM 可用（kie 等，经 `invokeLLMWithKie` 门控）+ 一台可达的 ComfyUI 服务器。
- 审计动作：`superagent_comfy_build`。

---

## 二、代码任务模式（需显式启用）

无头 Claude Code。**默认完全 inert**，需运维在服务器上逐项开启。

### 1) 前置：装 Claude Code CLI + 配认证（服务器上）

```bash
npm install -g @anthropic-ai/claude-code      # 或原生安装器
# 服务端无头认证（择一，免浏览器登录）：
export ANTHROPIC_API_KEY="sk-ant-..."          # Console 按量 key
# 或： export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"   # 订阅长效 token
```

CLI 路径非默认时用 `CLAUDE_BIN` 指定（如 Windows：`CLAUDE_BIN=C:\...\claude.cmd`）。

### 2) 开启（env 双钥）

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `SUPER_AGENT_CODE_ENABLED=1` | **第一把钥匙**：允许起 claude 进程。不设=完全禁用 | 关 |
| `SUPER_AGENT_CODE_ALLOW_BASH=1` | **第二把钥匙**：额外放行 shell。不设=只 Read/Edit/Write（无 shell） | 关 |
| `CLAUDE_BIN` | claude 可执行文件路径 | `claude` |

只设第一把钥匙：智能体只能在工作区读写文件，**不能跑任何命令**（最安全的可用档）。

### 3)（可选，强烈建议）执行前命令审批

放行 shell 后，默认靠「事后监控」（危险命令跑了立即杀进程止损）。要升级为**执行前拦截**（危险命令根本不跑），配置权限审批 MCP：

| 环境变量 | 值 |
|---|---|
| `SUPER_AGENT_PERMISSION_CMD` | 启动权限 MCP 服务器的命令，如 `node` |
| `SUPER_AGENT_PERMISSION_ARGS` | JSON 数组参数，指向已构建的 `permissionMcpServer`，如 `["/app/dist/server/_core/superAgent/permissionMcpServer.js"]` |

配置后，每条命令在执行前经 `commandPolicy` 审批（危险即拒、不执行）。
> 注：`--permission-prompt-tool` 的 claude↔MCP wire 契约官方尚未文档化，本实现按推断对齐、MCP 服务器本身已验证；未确认前，事后监控仍作兜底。

### 安全分层（代码任务）

1. 默认关闭（env 双钥）+ 超管 L4 + 项目编辑者；
2. **一次性隔离工作区**（`mkdtemp`，cwd 与 `--add-dir` 均限于此），结束即删；
3. 成本封顶 `--max-budget-usd`（默认 \$2，节点可调 ≤\$20）+ 硬超时（默认 300s，≤900s）；
4. **执行前**（若配审批 MCP）：`commandPolicy` 拒绝危险命令，不执行；
5. **执行后**：stream 监控兜底，漏网危险命令即杀进程。

审计动作：`superagent_code_task`（含 status / 被拦命令 / 成本 / 轮数 / 退出码）。

> ⚠️ 即便层层设防，「代码任务」本质是在服务器上跑 AI 编码智能体（受限但仍是执行）。请仅在受信任的运维前提下开启，且**工作目录隔离 ≠ 内核级沙箱**——需要强隔离时应在 WSL2/Docker 里运行整个服务。

---

## 相关代码

- 引擎：`server/_core/superAgent/comfyAgent.ts`（ComfyUI 闭环）、`codeAgent.ts`（stream-json 解析 + 命令监控）。
- 适配：`comfyAdapters.ts`、`claudeProcess.ts`（spawn + 双钥 + 权限接线）、`permissionPolicy.ts` / `permissionMcpServer.ts`（执行前审批）。
- 路由：`server/routers/superAgent.ts`（`buildComfyWorkflow` / `runCodeTask` / `codeStatus`）。
- 画布节点：`client/src/components/canvas/nodes/SuperAgentNode.tsx`；活动日志经 `superagent:event` socket 回灌。
