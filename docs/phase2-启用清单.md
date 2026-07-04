# 工程智能体 · Phase 2「代码任务」启用清单（走订阅 + 档位 C 执行前拦截）

> 这是一份可勾选的操作清单。完整原理见 `docs/super-agent.md`。
> Phase 2 默认**完全关闭**——本质是在服务器上跑能执行命令的 AI，仅在受信任的运维前提下开启。

## 计划：在跑 Node 服务的那台机上，走 Max/Pro 订阅额度（不按 token 收费）+ 执行前命令审批

### 1) 装 Claude Code CLI（和 Node 服务同机）
```bash
npm install -g @anthropic-ai/claude-code
```
- [ ] 已安装；`claude --version` 有输出
- [ ] （CLI 不在 PATH 时）记下绝对路径，Windows 一般是 `...\npm\claude.cmd`

### 2) 订阅授权（不按 token 另收费）
在一台**能开浏览器、且登录了你订阅账号**的机器上：
```bash
claude setup-token
```
- [ ] 拿到长效 token（约一年有效；跟账号绑定，在哪生成都能用）
- [ ] **不要**同时设 `ANTHROPIC_API_KEY`（否则 API key 优先 → 变按量计费）

### 3) 构建（产出零依赖权限 MCP 单文件）
在服务器的项目目录：
```bash
npm run build          # 已自动包含 build:superagent-mcp
# 或单独：npm run build:superagent-mcp
```
- [ ] 产出 `dist/permissionMcpServer.cjs`（约 7KB，零外部依赖）

### 4) 配环境变量（设到 Node 进程实际读取环境的地方）
```
# 授权：只设订阅 token，别设 ANTHROPIC_API_KEY
CLAUDE_CODE_OAUTH_TOKEN=第2步的token

# 双钥开启 + 放行 shell
SUPER_AGENT_CODE_ENABLED=1
SUPER_AGENT_CODE_ALLOW_BASH=1

# 档位 C：执行前审批 MCP（危险命令根本不跑）
SUPER_AGENT_PERMISSION_CMD=node
SUPER_AGENT_PERMISSION_ARGS=["你的项目绝对路径/dist/permissionMcpServer.cjs"]
# Windows 路径要双反斜杠转义，如：
# SUPER_AGENT_PERMISSION_ARGS=["D:\\avc\\dist\\permissionMcpServer.cjs"]

# 可选：CLI 不在 PATH 时
# CLAUDE_BIN=claude 的绝对路径
```
- [ ] 五个变量已设到 Node 服务读取的环境（系统环境变量 / 服务配置 / .env）

### 5) 权限 + 重启
- [ ] 管理后台把你的账号设为**超级管理员 L4**
- [ ] **重启 Node 服务**（让环境变量生效）

### 6) 使用与验证
- [ ] 画布建「工程智能体」→ 切「代码任务」→ 不再显示「未启用」
- [ ] 跑一个任务；危险命令（rm -rf / sudo / dd 等）应在**执行前**被拒、不执行

---

## 安全分层（已内置）
1. 默认关闭（env 双钥）+ 超管 L4 + 项目编辑者；
2. 一次性隔离工作区（用完即删）；
3. 成本封顶 `--max-budget-usd`（默认 \$2，节点可调 ≤\$20）+ 硬超时（默认 300s，≤900s）；
4. **执行前**：`commandPolicy` MCP 拒绝危险命令；
5. **执行后**：stream 监控兜底，漏网危险命令即杀进程。

## 需真机确认的一点
`--permission-prompt-tool` 的 claude↔MCP wire 官方尚未文档化，按推断实现。
**MCP 服务器本身已验证**（canned JSON-RPC：安全→allow、`rm -rf`→deny）；但 claude 侧是否
如期调用需第一次真机跑确认——若发现危险命令仍被执行，把活动日志发来调；确认前第 5 层兜底。

## 想更稳的最小起步（档位 A）
先只设 `CLAUDE_CODE_OAUTH_TOKEN` + `SUPER_AGENT_CODE_ENABLED=1`（不设 `ALLOW_BASH` 与审批 MCP），
此档智能体只能在隔离目录**读写文件、不跑任何命令**，最安全；跑通后再逐步加 shell 与审批 MCP。
