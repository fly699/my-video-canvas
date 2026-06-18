# 多风格架构 + 「工作室（Studio）」风格 — 实施计划

> 目标：在**不影响现有主体功能**的前提下，新增可切换的界面风格（首选「Studio 影院工作室版」，可选「极简易读浅色版」）。
> 铁律：**逻辑唯一、皮肤可换**——此后所有功能性开发/更新，各风格**自动同步**，绝不维护两份节点逻辑。

本计划综合了多家参考的长处（LibLib 媒体优先 + 上下悬浮、右侧检查器、亮绿带点数主按钮、`•••`溢出菜单、组工具条「整组执行/更新模板/解组」、按量计费贴发送键、媒体「替换」、Advanced 折叠、分区大标题、左竖栏+小地图），并对齐项目现有架构（`CanvasModeContext`、`CustomNode` 分发、`useCanvasStore` 公共 action）。

---

## 一、架构总纲：三层严格分离（这是「自动同步」的根本保证）

```
┌── Layer 1  数据 / 逻辑（唯一真源 · 与风格无关） ────────────────────────┐
│  后端 tRPC 过程、运行器(runner)、模型注册表、点数预估、门控、连线规则、    │
│  payload 默认值(getDefaultPayload)、zustand store actions(addNode/...).   │
│  —— 一切「功能」都只在这里开发，天然被所有风格共享。皮肤里【零】业务逻辑。 │
└───────────────────────────────────────────────────────────────────────┘
            ▲ 读取                              ▲ 读取
┌── Layer 2  节点契约 NodeUiSpec（声明式 · 自动同步的「合同」） ───────────┐
│  每个节点声明：mediaSlot(预览) / fields(可编辑参数:id,kind,label,options, │
│  group:basic|advanced) / actions(主操作+次要操作) / ports(带类型连接口)。 │
│  —— 新增一个参数只改这里【一处】，所有风格都自动渲染出来。              │
│  尽量从现有来源派生(ParamControls schema、模型表、默认 payload)，少重复声明。│
└───────────────────────────────────────────────────────────────────────┘
            ▲ 渲染                              ▲ 渲染
┌── Layer 3  皮肤 Skin（纯展示 · 可换） ──────────────────────────────────┐
│  pro(现状,一行不改) / studio(新增) / simple(可选浅色)。                  │
│  每个皮肤用自己的组件+布局+CSS token 渲染同一份「契约」。皮肤永不含逻辑， │
│  只调用 Layer 1 的 store action。                                        │
└───────────────────────────────────────────────────────────────────────┘
```

**自动同步保证：**
- 新增**功能**（模型 / 运行器 / 能力 / 后端）→ 落 Layer 1 → 所有皮肤免费获得。
- 新增**参数 / 控件** → 落 Layer 2 契约一处 → 所有皮肤自动渲染。
- 新增**节点类型** → 注册到共享注册表 + 提供契约 → 所有皮肤出现；皮肤若无定制布局，走**通用 spec 渲染器**兜底，立即可用。

**双重兜底（既不破坏 pro，也不复制逻辑）：**
1. Studio 优先用 `SpecNode` 按契约渲染（多数节点"免费"获得 Studio UI，无需手写 28 个 studio 组件）。
2. 节点尚未声明契约时，Studio 直接**内嵌该节点现有的 pro 内容子树**于 Studio 外框中 —— 保证「不崩 + 新参数照样出现（因为就是 pro 本体）」。

> 结论：`pro` 永不被改动；`studio` 要么按契约渲染、要么内嵌 pro 本体；两条路都让新功能自动出现。

---

## 二、与现有代码的对接点（全部可复用，零改主体）

| 新形态 | 复用现有 |
|---|---|
| 风格切换机制 | 照搬 `CanvasModeContext`（localStorage + `data-*` 属性 + CSS 覆盖块） |
| 媒体优先 / 选中折叠参数 | 现有 `creative` 画布模式基础（BaseNode 已读 `useCanvasMode`） |
| 加节点 / 连线 / 自动布局 / 变体 | `useCanvasStore`：`addNode/onConnect/batchAddSceneNodes/autoLayout/createVariants` |
| 组工具条 整组执行/解组/更新模板 | `requestRun` / `groupSelected`·`ungroup` / 快照 `saveNamedSnapshot` 或节点模板库 |
| 从端口延伸建节点 | 现有 `connectMenu` + `connectionRules` |
| 小地图 / 缩放 | ReactFlow `<MiniMap>` / `<Controls>` |
| `•••` 扩图/抠图/增强/切分 | 现有 PostProcess / 编辑能力与节点 |
| 按量计费贴发送键 | 现有点数预估 |
| 模型下拉（含自建置顶） | `LLMModelPicker` / `useSelfHostedLlmModels` / `modelGroupOrder` |

---

## 三、分阶段实施（PR 拆分）

### Phase 0 — 风格基础设施（纯增量，零逻辑风险）
- 新建 `client/src/contexts/UIStyleContext.tsx`：`UIStyle = "pro" | "studio" | "simple"`，存 `localStorage: avc:ui-style`，应用 `document.documentElement[data-ui]`；在 `App.tsx` 嵌套 Provider（与 Theme/CanvasMode 并列）。
- 首页 + 画布顶栏加「界面风格」三档段控（专业 / 工作室 / 极简）。
- `index.css` 新增 `:root[data-ui="studio"]` token 块（影院暗配色、4 档字阶、间距/圆角、细柔连线）——**只影响 studio**。
- **验收**：切换风格仅 CSS 变化；`pro` 像素级不变；`tsc`/`build` 全绿。
- 影响面：新增文件 + 1 处 App 包裹 + 1 段 CSS。**不碰任何功能代码。**

### Phase 1 — 节点契约 + 通用 Studio 渲染器（自动同步引擎，核心）
- 定义 `NodeUiSpec` 类型与解析 `useNodeUiSpec(nodeType, payload)`：**尽量从现有 ParamControls schema / 模型表 / 默认 payload 派生**，减少重复声明。
- `canvas/studio/SpecNode.tsx`：按契约渲染 = 媒体优先外框 + 命令条(basic 字段) + 右侧检查器(全字段) + `•••`溢出(次要 actions) + Advanced 折叠(advanced 字段)。
- 共享控件库 `canvas/studio/controls/`：`CommandChip / InspectorRow / Stepper / BigSwitch / Segmented / Tabs / RefThumbs / LimeRunButton / TypedPort / CostPill`。
- 兜底：未声明契约的节点 → `EmbedProBody`（把现有 pro 节点内容塞进 Studio 外框）。
- **验收**：Studio 能渲染**所有**节点类型（契约或兜底）；读同一 payload/store；`pro` 不变。新增「每种节点 × 每种风格都能渲染不崩」冒烟测试。

### Phase 2 — Studio 画布外壳与节点框
- `BaseNodeStudio`：媒体优先、上方悬浮工具条（含 `•••`）、带类型连接口、选中蓝环、媒体上「替换」、命令条、按量计费贴发送键、胶片条。
- 右侧 `Inspector` 容器：跟随选中节点，标签→值大行 + 亮绿主按钮。
- 「组」即功能区：组标题 + 浮动组工具条（`▶整组执行`→`requestRun`、`更新模板`→快照/模板库、`解组`→`ungroup`）。
- 画布外壳：左竖栏、小地图（RF MiniMap）、分区大标题（复用 group 标题）、顶栏点数/社区/分享（接现有）。
- **验收**：完整 Studio 画布可用；`pro` 不受影响；保存/协作/导出与 pro 一致。

### Phase 3 — Studio 创建流程
- `StudioAddPanel`：左侧极简列表 + 影院级配方卡（复用 `recipes`/`batchAddSceneNodes`）。
- 从端口延伸（复用 `connectMenu`）。
- **验收**：在 Studio 下能建节点/成链；数据与 pro 完全互通、可切回。

### Phase 4 — 旗舰节点定制布局（打磨）+ 可选浅色「极简」皮肤
- 为高频 6–8 个节点（image_gen/video_task/storyboard/script/audio/merge/ai_chat/character）写**定制 Studio 布局**，仍由同一契约驱动（继续自动同步）。
- 可选：用**同一契约**实现浅色「极简易读」皮肤（新手向）。
- **验收**：旗舰节点更精致；其余仍走 SpecNode/兜底；一切照常自动同步。

### Phase 5 — 加固与验收
- 逐节点 × 逐风格无头浏览器走查；性能（风格切换仅 CSS、无重渲染风暴）；持久化/协作/导出三风格一致性；回滚演练。

---

## 四、护栏与回滚

- **pro 皮肤一行不改**：独立目录 `canvas/studio/` + CSS 由 `[data-ui]` 限定，互不渗透。
- **皮肤零逻辑** → 功能更新天然自动同步。
- **参数自动同步**靠契约；**节点类型自动同步**靠共享注册表 + 兜底渲染。
- **回滚** = 删 `canvas/studio/` 目录 + 删 `[data-ui="studio"]` CSS 块 + 摘掉 Provider 包裹；`pro` 完整无痕。
- **测试**：契约解析单测；「所有节点 × 所有风格可渲染」冒烟测试；保存/导出 payload 不随风格变化的回归测试。

---

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| 个别 bespoke 节点契约覆盖不全 | `EmbedProBody` 兜底，保证不崩、参数照出 |
| 命令条与检查器「两处编辑」状态不一致 | 二者读写同一 `payload`，单一状态源 |
| 契约 + 通用渲染器是前期投入 | 一次性投入换长期「自动同步」，避免 28×N 复制维护 |
| 新人误把逻辑写进皮肤 | Lint/约定：`canvas/studio/` 内禁止 import 后端/运行器，仅允许 store actions + 契约 |

---

## 六、建议执行顺序与里程碑

1. **Phase 0**（最小可跑：风格开关 + data-ui + 影院 token，先不碰节点） → 可立刻真机感受外观。
2. **Phase 1**（契约 + SpecNode + 控件库 + 兜底） → 自动同步引擎就位，Studio 全节点可用。
3. **Phase 2/3**（外壳 + 创建流程） → 完整体验。
4. **Phase 4/5**（旗舰打磨 + 可选浅色皮肤 + 加固）。

> 首选先做 **Studio**（综合体验最佳、复用 creative 最省力）；「极简易读浅色版」作为可选第三档，用同一契约低成本产出。
