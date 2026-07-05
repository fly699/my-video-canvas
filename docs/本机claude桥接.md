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
> CLI 不在 PATH 时用 `CLAUDE_BIN` 指定完整路径（Windows 一般 `C:\Users\你\AppData\Roaming\npm\claude.cmd`）。

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

1. **服务器装 Codex CLI**:`npm i -g @openai/codex`(路径特殊时可设 `CODEX_BIN` 指向完整路径)。
2. **订阅登录**:在**能开浏览器**的机器上跑 `codex`,选「**Sign in with ChatGPT**」登录订阅账号;登录凭证会存到该机的 `~/.codex/auth.json`。
3. **把凭证放到服务器**:将 `~/.codex/auth.json` 拷到服务器同路径(Windows:`C:\Users\你\.codex\auth.json`)。该文件等同密码,注意保管。
4. **后台**:模型管理 › 自建 LLM → 点「**一键填入本机 GPT(ChatGPT 订阅)**」→ 保存(地址/Key 与 Claude 完全共用,已配过就不用动)。

之后画布模型选择器会出现「本机 GPT(订阅默认)」「本机 GPT · Codex」。模型 id 规则同 Claude:`gpt-local` = 订阅默认;`gpt-local:模型名` 透传给 `codex -m`(如 `gpt-local:gpt-5.3-codex`;有效模型名随 OpenAI 更新,以 `codex -m` 接受的为准)。

### GPT 侧注意

- 凭证优先级:`CODEX_API_KEY > auth.json(订阅) > OPENAI_API_KEY`。
  - **千万别设 `CODEX_API_KEY`**——它排在订阅前面,设了就绕过订阅变按量计费。
  - `OPENAI_API_KEY` **可以设**(本项目配音 TTS 就在用它):只要 auth.json 在,codex 优先走订阅、不碰它。
    但反过来,**若 auth.json 没放好**,codex 会静默落到 `OPENAI_API_KEY` 按量计费——放好凭证再用 `gpt-local` 条目。
- 桥接以 `codex exec --sandbox read-only` 跑(禁写文件系统),纯文本进出,与 Claude 侧同等安全。
- 额度受 ChatGPT 订阅用量上限约束,同样会被限流;合规注意事项与 Claude 侧相同。
- 排错:节点报「无法启动 codex」→ CLI 没装或 `CODEX_BIN` 不对;报「无输出/退出码非 0」→ 多半是凭证没放好,在服务器命令行手测 `codex exec --skip-git-repo-check "你好"`。

## 注意事项

- **额度与限流**：所有走这条路的调用共用你这个订阅账号的用量上限，撞上限会被限流（不扣钱，但会卡）。当多用户高频后端使用时尤其容易顶到上限。
- **合规**：订阅计费本为**交互式使用**（Claude Code / 桌面 app）设计，拿来当 app 后端批量调用属灰色地带；要正规程序化调用，官方路子是 API Key（按量计费）。
- **公网隧道部署**：一键填入用的是当前站点 origin。若你的应用挂在 cloudflared 隧道后，请把「服务器地址」手动改成内网回环 `http://127.0.0.1:<内部端口>/api/claude-bridge`，让服务端直接打本机、不绕公网。
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
