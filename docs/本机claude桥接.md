# 本机 Claude（订阅）接入 —— 用订阅额度跑画布 AI

把你的 **Claude 订阅（Pro/Max）**额度接进来，给画布里的 **AI 对话节点 / 工程智能体规划 / AI 编排**等所有 LLM 调用用——**不按 token 计费**（受订阅用量上限约束）。

## 原理（30 秒）

订阅的 token（`claude setup-token` 出的 `CLAUDE_CODE_OAUTH_TOKEN`）**不是 API Key**，只有 Claude Code CLI 认它，不能直接当 OpenAI/Anthropic 接口用。所以本项目内置了一个**桥接端点**：

```
画布(OpenAI 格式) → 本机桥接 /api/claude-bridge/v1/chat/completions
                    → 服务端跑一次 `claude -p`（用订阅额度）
                    → 结果包成 OpenAI chat.completion 返回
```

桥接**纯文本进出**：不授予任何工具、不碰你的项目文件，比「代码任务」安全得多；且**默认完全关闭**，不设口令就不启用。

## 配置（三步，都在服务器 + 后台）

### 第 1 步：服务器装 Claude Code + 登录订阅

```bash
npm i -g @anthropic-ai/claude-code      # 装 CLI
claude setup-token                       # 在能开浏览器、已登录订阅账号的机器上跑一次，拿到长效 token（约一年）
```

把拿到的 token 设为服务端环境变量：

```
CLAUDE_CODE_OAUTH_TOKEN=<setup-token 拿到的值>
```

> ⚠️ **切勿同时设 `ANTHROPIC_API_KEY`**——一旦设了，Claude 会优先用 API Key → 变成按 token 计费，订阅就白搭了。
> Windows 标准 npm 全局路径（`C:\Users\你\AppData\Roaming\npm\claude.cmd`）**新版会自动探测，免设 `CLAUDE_BIN`**；装在别处才需要设完整路径。

### 第 2 步：设一个桥接口令（= 开启开关）

```
CLAUDE_LOCAL_BRIDGE_KEY=<你自己编的任意字符串，如 my-local-claude-8f3a>
```

这个口令**同时起两个作用**：设了才启用桥接（不设 = 桥接返回 404 未启用）；且每个请求必须带对它才放行（防止公网下被白嫖订阅）。

> 两个变量都**写进项目根目录 `.env`**（`update.bat`/「系统更新」/Windows 服务都读它），**设完重启服务**（跑一次 `update.bat` 也会自动重启）。

### 第 3 步：后台一键接入

管理后台 → **模型管理 › 自建 LLM** → 顶部「**本机 Claude（订阅）接入**」卡片：

1. 点「**一键填入本机 Claude 地址与模型**」——自动填好服务器地址（当前站点 + `/api/claude-bridge`）和模型 `claude-local`。
2. 把下方 **API Key** 填成与第 2 步 `CLAUDE_LOCAL_BRIDGE_KEY` **完全一致**的值。
3. 点「**保存配置**」。

保存后，全站模型选择器里就会出现「**本机 Claude（订阅）**」，在任意 AI 对话/规划节点选它即可。门控与 ComfyUI 自建一致（走「ComfyUI 免白名单」开关）。

## 切换模型

「一键填入」现在会登记 3 个条目,在**画布模型选择器里选哪个就用哪个**:

| 选择器条目 | 实际模型 |
|---|---|
| 本机 Claude(订阅默认) | 不传 `--model`,用订阅默认 |
| 本机 Claude · Sonnet | `claude --model sonnet` |
| 本机 Claude · Opus(需 Max) | `claude --model opus` |

规则:模型 id 里 `claude-local:` 冒号后面的部分会被透传给 `claude --model`。想加别的,在后台「模型」列表手动加条目即可,例如:

- `claude-local:haiku` → Haiku(最快最省额度)
- `claude-local:sonnet[1m]` → Sonnet 1M 上下文(需订阅支持)
- `claude-local:claude-sonnet-4-5-20250929` → 锁定完整模型 id

> **订阅档位限制**:Pro 档只能用 Sonnet;**Opus 需 Max 档**——Pro 选 Opus 会直接报错(报错会浮出到节点)。切换模型不需要重启服务,后台保存即生效。

## 再接 GPT(ChatGPT 订阅)——同一个桥接、零新增配置

GPT 侧的订阅等价物是 OpenAI **Codex CLI**(可用 ChatGPT Plus/Pro 订阅登录,不按 token 计费)。桥接**与 Claude 共用同一地址、同一 Key**,按模型前缀分流(`gpt-local*` → codex,其余 → claude),所以不需要任何新的环境变量。

### 步骤

1. **服务器装 Codex CLI**:`npm i -g @openai/codex`,**装完重启本服务**(新装的 CLI 要重启后才可见)。Windows 标准路径自动探测、免设 `CODEX_BIN`;装在别处才设完整路径。
2. **订阅登录**:在**能开浏览器**的机器上跑 `codex`,选「**Sign in with ChatGPT**」登录订阅账号;登录凭证会存到该机的 `~/.codex/auth.json`。
3. **把凭证放到服务器**:将 `~/.codex/auth.json` 拷到服务器同路径(Windows:`C:\Users\你\.codex\auth.json`)。该文件等同密码,注意保管。
4. **后台**:模型管理 › 自建 LLM → 点「**一键填入本机 GPT(ChatGPT 订阅)**」→ 保存(地址/Key 与 Claude 完全共用,已配过就不用动)。

之后画布模型选择器会出现「本机 GPT(订阅默认)」。模型 id 规则同 Claude:`gpt-local` = 订阅默认;`gpt-local:模型名` 透传给 `codex -m`。

> **想固定具体模型?先真机验证再加条目。** 有效模型名随 OpenAI 版本/账号变动(一键填入不预置具体名,就是因为预置的名字在别的账号/版本上会报「未找到模型元数据」)。步骤:在服务器命令行跑 `codex exec --skip-git-repo-check -m 模型名 "hi"`,能正常回答 → 后台「模型」列表手动加 `gpt-local:该模型名` 条目;报「未找到模型元数据 / model not found」→ 换名字。

### GPT 侧注意

- 凭证优先级:`CODEX_API_KEY > auth.json(订阅) > OPENAI_API_KEY`。
  - **千万别设 `CODEX_API_KEY`**——它排在订阅前面,设了就绕过订阅变按量计费。
  - `OPENAI_API_KEY` **可以设**(本项目配音 TTS 就在用它):只要 auth.json 在,codex 优先走订阅、不碰它。
    但反过来,**若 auth.json 没放好**,codex 会静默落到 `OPENAI_API_KEY` 按量计费——放好凭证再用 `gpt-local` 条目。
- 桥接以 `codex exec --sandbox read-only` 跑(禁写文件系统),纯文本进出,与 Claude 侧同等安全。
- 额度受 ChatGPT 订阅用量上限约束,同样会被限流;合规注意事项与 Claude 侧相同。
- 排错:节点报「无法启动 codex(ENOENT)」→ ①没装:`npm i -g @openai/codex` 后**重启服务**;②装了但在非标准路径:设 `CODEX_BIN`;报「无输出/退出码非 0」→ 多半是凭证没放好,在服务器命令行手测 `codex exec --skip-git-repo-check "你好"`;报「**未找到"某模型"的模型元数据**/model not found + 4xx」→ 该条目的模型名在你的 codex 版本/账号不可用,把后台该 `gpt-local:模型名` 条目删掉或改成真机验证过的名字(`gpt-local` 默认条目不受影响)。

## 附件（图片 / 文档）

本机订阅模型**支持在 AI 对话里带图片和文档附件**（和云端视觉模型一样，在对话节点/聊天框点回形针或拖入即可）：

| 附件 | Claude 侧 | GPT（codex）侧 |
|---|---|---|
| **图片**（png/jpg/gif/webp） | 走 `claude -p --input-format stream-json` 内联 base64 图片块，模型直接「看到」图 | 落成临时文件用 `codex exec -i <文件>` 传入，用完即删 |
| **文档**（PDF/Word/PPT/Excel/txt/md…） | 服务端解析成文本内联进提示词 | 同左 |

要点：
- **纯文本问答不受影响**——只有检测到附件才走加料路径。
- 图片单张上限约 12MB；文档解析上限 50K 字符（超出截断）。
- **视觉能力取决于订阅模型本身**：Claude 选到带视觉的模型（Sonnet/Opus 系）才能看图；codex 默认模型支持看图。选到纯文本模型时图片会被模型忽略（不报错）。
- 服务端会把画布里的图片（`/manus-storage/...` 或 data URL）自动取出、编码后喂给 CLI，无需你手动处理。

## 让桥接用上「技能 / MCP」（可选，默认关闭）

桥接默认是**纯文本问答**（不给任何工具，最安全）。若你要让本机订阅 Claude 在画布对话里**调用技能（Skills）或 MCP 服务器**，设下面的 env 开启（写进项目根 `.env`，**重启服务**生效）。不设 = 保持纯文本、行为不变。

| 变量 | 作用 |
|---|---|
| `CLAUDE_BRIDGE_SKILLS=1` | 放行 `Skill` 工具。技能放到服务器的 `~/.claude/skills/<名>/SKILL.md`（无头模式会自动发现），对话里让它「用某某技能」即可。 |
| `CLAUDE_BRIDGE_MCP_CONFIG=<路径或内联JSON>` | 挂载 MCP 服务器。给**文件路径**（推荐，如 `/etc/avc/mcp.json`）或**内联 JSON**；桥接会 `--mcp-config` 加载并放行其 `mcp__<服务名>` 工具。 |
| `CLAUDE_BRIDGE_ALLOWED_TOOLS`（可选） | 覆盖默认放行工具集。默认：`Read,Glob,Grep,WebSearch,WebFetch`（+ `Skill`、+ 各 MCP 服务器工具）。**默认不含 `Bash`/`Write`/`Edit`**——桥接不写文件、不跑 shell。 |
| `CLAUDE_BRIDGE_PERMISSION_MODE`（可选） | 权限模式，默认 `default`（仅放行的工具可用，其余无头下一律拒，最稳）。 |

MCP 配置文件示例（`mcp.json`）：

```json
{ "mcpServers": {
  "fetch": { "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"] },
  "mydb":  { "type": "http", "url": "http://内网IP:8080/mcp" }
} }
```

> **技能已在本机用订阅实测跑通**（放一个测试技能 → 对话里让它用 → 确实按技能指令回复）。MCP 走同一套
> `--mcp-config` 机制，配好上面的文件即生效。

> ⚠️ **安全**：开启后，这个「可能公网可达、只有一把 bridge key」的聊天口就获得了工具/MCP 能力；MCP 服务器由你自选、其工具被**预授权（不再逐次审批）**。**建议仅在内网/受信任部署开启，别接高危 MCP**（能写文件系统 / 跑命令的）。要「读写文件 + 执行前逐条审批」的重型智能体，仍走工程智能体「代码任务」通道（`docs/phase2-启用清单.md`）。
> **GPT（codex）侧**：codex 的 MCP 在其自身 `~/.codex/config.toml` 的 `mcp_servers` 配置，与本桥接 env 无关。

## 注意事项

- **额度与限流**：所有走这条路的调用共用你这个订阅账号的用量上限，撞上限会被限流（不扣钱，但会卡）。当多用户高频后端使用时尤其容易顶到上限。
- **合规**：订阅计费本为**交互式使用**（Claude Code / 桌面 app）设计，拿来当 app 后端批量调用属灰色地带；要正规程序化调用，官方路子是 API Key（按量计费）。
- **公网隧道部署**：新版「一键填入」会**直接填本机回环地址** `http://127.0.0.1:<内部端口>/api/claude-bridge`（端口由服务端上报，无需自己查）；即使手填了公网域名，服务端也会**自动识别**「地址指向本应用桥接」并强制改走本机回环（老版本填公网域名会绕出公网被 Cloudflare 卡 502/超时）。
- **默认模型**：桥接不指定 `--model`，用订阅的默认模型。
- **部署生效**：改了服务端 env 必须**重启 node 进程**；改了后台自建 LLM 配置即时生效（无需重启）。

## 排错

| 现象 | 排查 |
|---|---|
| 节点报「桥接未启用」/ 404 | 服务端没设 `CLAUDE_LOCAL_BRIDGE_KEY`，或没重启 |
| 报「API Key 不匹配」/ 401 | 后台自建 LLM 的 API Key 与服务端 `CLAUDE_LOCAL_BRIDGE_KEY` 不一致 |
| 报「无法启动 claude」 | CLI 没装或 `CLAUDE_BIN` 路径不对（Windows 指到 `claude.cmd`） |
| 报「本机 claude 返回错误」且含认证字样 | 订阅没登录：在服务器命令行手测 `claude -p "hi"`；确认设了 `CLAUDE_CODE_OAUTH_TOKEN` 且**没设** `ANTHROPIC_API_KEY` |
| 一直转圈/超时 | 首次调用 claude 冷启动较慢；桥接硬超时 110s |
