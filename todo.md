# AI Video Canvas — TODO

## Phase 1: 项目结构 & 数据库 & 样式
- [x] 数据库 Schema：users, projects, canvas_nodes, canvas_edges, assets, video_tasks, chat_messages
- [x] 全局样式：深色优雅主题，自定义 CSS 变量，Google Font（Inter + Playfair Display + JetBrains Mono）
- [x] 顶部导航栏：Logo、项目切换、用户头像、导出按钮

## Phase 2: 无限画布核心
- [x] 无限画布容器（ReactFlow）
- [x] 鼠标/触控拖拽平移
- [x] 滚轮缩放（支持 pinch）
- [x] 多选框选节点（rubber-band selection）
- [x] 右键画布空白处：快速添加节点菜单
- [x] 右键节点：操作菜单（复制、删除）
- [x] 画布 viewport 持久化（保存到数据库）

## Phase 3: 节点系统 & 连线
- [x] 节点基础组件（可拖拽、可选中、可调整大小）
- [x] 脚本节点（Script Node）：文本编辑
- [x] 分镜节点（Storyboard Node）：图片预览 + 提示词
- [x] 提示词节点（Prompt Node）：正/反向提示词编辑
- [x] 素材节点（Asset Node）：图片/视频预览
- [x] 视频任务节点（Video Task Node）：任务状态展示
- [x] AI 对话节点（AI Chat Node）：内嵌对话面板
- [x] 便签节点（Note Node）
- [x] 节点连线（拖拽端口连线，贝塞尔曲线）
- [x] 连线删除（Delete 键）

## Phase 4: AI 功能
- [x] AI 对话节点：调用 LLM API
- [x] 上下文感知：对选中节点内容发起 AI 问答
- [x] 分镜节点内嵌图像生成（调用 imageGeneration helper）
- [x] 提示词节点一键生成图像预览

## Phase 5: 项目管理 & 素材
- [x] 画布项目 CRUD（新建、重命名、删除、切换）
- [x] 画布数据自动保存到数据库（debounce 2s）
- [x] JSON 导出当前画布
- [x] 素材上传（图片/视频，上传到 S3，base64 传输）
- [x] 素材管理面板（侧边栏）

## Phase 6: 视频任务节点
- [x] 视频任务节点 UI：提示词、参考图、参数配置
- [x] 对接 Runway API（提交任务、轮询状态）
- [x] 对接 Kling API（提交任务、轮询状态）
- [x] Mock provider 用于测试（15s 后自动完成）
- [x] 任务状态轮询（服务端 setInterval 10s）
- [x] 视频结果在节点内播放

## Phase 7: 多人实时协作
- [x] WebSocket 服务端（Socket.io）
- [x] 节点位置/内容变更实时广播
- [x] 协作者光标实时显示（带用户名/颜色）
- [x] 在线用户列表展示

## Phase 8: UI 精修 & 测试
- [x] BaseNode group-hover 修复（header actions 可见性）
- [x] 动画与过渡效果（fadeIn, scaleIn, slideUp）
- [x] ReactFlow 样式覆盖（controls, minimap, handles）
- [x] Vitest 单元测试：24 个测试全部通过
- [x] 项目重命名 UI（画布顶部栏双击/铅笔图标）
- [x] Edges 持久化纳入自动保存
- [x] Viewport 变化标记 dirty 并保存
- [x] BaseNode group-hover 修复（group 类移至根容器）
- [x] TypeScript 类型错误全部修复（0 errors）
- [x] 24 个 Vitest 测试全部通过
- [x] 最终 Checkpoint 与交付

## Phase 9: UI 全面重做（对标 Runway/Linear）
- [x] 全局样式 index.css — 纯黑极简主题（#080808 底色 + 紫色品牌色）
- [x] 首页 Landing Page — 视觉冲击力强，项目卡片精美，动画效果
- [x] 画布页顶部栏 — 极简导航，项目重命名，协作者头像，快捷操作
- [x] 画布工具侧边栏 — 精致图标按钮，节点选择器弹出面板
- [x] BaseNode — 精致卡片式设计，玻璃质感，Handle 精美
- [x] ScriptNode / StoryboardNode / PromptNode — 独特视觉语言
- [x] VideoTaskNode / AIChatNode / NoteNode / AssetNode — 精美重做
- [x] ContextMenu — 精致右键菜单，节点图标彩色
- [x] CollaboratorCursors / AssetPanel — 精修细节
- [x] ErrorBoundary / ManusDialog / NotFound — 与深色主题一致，中文化
- [x] TypeScript 0 errors，24 Vitest 测试全部通过

## Phase 10: Bug 修复
- [x] 修复新用户登录后 Canvas 页面无限转圈（auth loading 状态守卫）
- [x] 添加首页（Home.tsx）登出按钮（用户头像旁）
- [x] 添加画布页（Canvas.tsx）顶部栏登出按钮
- [x] TypeScript 0 errors，26 Vitest 测试全部通过

## Phase 11: 图像生成节点 & 视频播放修复
- [x] 图像生成节点：添加模型选择器（Manus Forge / Flux 1.1 Pro / SDXL）
- [x] 图像生成节点：补全"生成图像"按钮（原节点缺失）
- [x] 图像生成节点：完整重写 UI（提示词、反向提示词、风格、比例、参考图）
- [x] 后端 imageGenRouter：添加 model 字段支持，按模型路由到不同后端
- [x] 后端 imageGeneration.ts：支持 manus_forge / poyo_flux / poyo_sdxl 三种模型
- [x] 视频播放：添加服务端视频代理 /api/video-proxy（解决 CORS/跨域问题）
- [x] VideoTaskNode 和 PresentationMode：外部视频 URL 通过代理播放
- [x] TypeScript 0 errors，26 Vitest 测试全部通过

## Phase 12: 视频播放 & 重置修复（Round 2）
- [x] 视频代理白名单改为 HTTPS 全域名允许（仅屏蔽内网 IP），修复跨域名视频被拒问题
- [x] Mock 测试视频 URL 换为可访问的 learningcontainer.com 视频（原 Google Storage 已私有）
- [x] 视频代理对上游 4xx 仍返回 CORS 头，避免浏览器 CORS 错误叠加
- [x] 添加 deleteVideoTask DB 函数
- [x] 添加 videoTasks.reset tRPC mutation（删除 DB 记录）
- [x] VideoTaskNode 重置按钮在 succeeded 和 failed 状态均显示
- [x] 重置后清空 taskId/resultVideoUrl/errorMessage，状态回到 pending
- [x] 提交按钮在 succeeded 状态下禁用（需先重置才能重新提交）
- [x] TypeScript 0 errors，26 Vitest 测试全部通过

## Phase 13: Poyo Bug 修复 + Runway/Kling 清理 + 模型选择器扩展
- [x] 修复 videoTaskPoller.ts submit 分支：Poyo provider 调用 submitPoyoVideo() 而非 submitMockTask()
- [x] 修复 videoTaskPoller.ts poll 分支：Poyo provider 调用 checkPoyoVideoStatus() 而非 pollMockTask()
- [x] 删除 Runway/Kling API Key 相关代码（provider 选项保留但标注需配置 Key）
- [x] StoryboardNode 添加图像模型选择器（Manus Forge / Flux 1.1 Pro / SDXL）
- [x] PromptNode 添加图像模型选择器（Manus Forge / Flux 1.1 Pro / SDXL）
- [x] TypeScript 0 errors，测试全部通过

## Phase 14: 模型参数完整化 + 参考图上传
- [x] 阅读 Higgsfield 官方文档，记录每个视频/图像模型的完整参数
- [x] 阅读 Poyo.ai 官方文档，记录 Seedance 2 / Veo 3.1 的完整参数
- [x] VideoTaskNode：每个模型显示对应的参数面板（分辨率、时长、宽高比等）
- [x] ImageGenNode：添加参考图文件上传按鈕（上传到 S3，自动填入 URL）
- [x] StoryboardNode/PromptNode：同步添加参考图上传
- [x] TypeScript 0 errors，测试全部通过

## Phase 15: 视频下载 + 撤销/重做 + Reve 参数面板
- [x] VideoTaskNode：生成成功后显示下载按钮（通过 video-proxy 代理下载，触发 Content-Disposition）
- [x] 画布 Cmd+Z / Ctrl+Z 撤销、Cmd+Shift+Z / Ctrl+Y 重做（Zustand 历史栈，节点/边变更时快照）
- [x] ImageGenNode：Reve 模型专属参数面板（aspect_ratio 下拉 + resolution 下拉）
- [x] TypeScript 0 errors，测试全部通过

## Phase 16: 批量图像生成网格展示
- [x] 后端 imageGeneration.ts：Soul Standard batchSize>1 时返回多张图 URL 数组
- [x] 后端 canvas.ts imageGenRouter：返回 urls 数组（向后兼容 url 单图）
- [x] shared/types.ts：ImageGenNodeData 添加 imageUrls 字段（多图数组）
- [x] 前端 ImageGenNode：生成后以网格形式展示多张图，点击选中某张作为最终 imageUrl
- [x] 选中图片高亮边框，未选中半透明；支持重新生成（清空多图）
- [x] TypeScript 0 errors，测试全部通过

## Phase 17: Lightbox 预览 + 图像下载 + 连线输入
- [x] 创建 ImageLightbox 组件（全屏遮罩、ESC/点击关闭、左右切换、键盘方向键）
- [x] ImageGenNode 批量网格：点击图片打开 Lightbox，Lightbox 内可选择/关闭
- [x] ImageGenNode 已选图预览区域添加下载按鈕（通过 /api/image-proxy 代理下载）
- [x] 服务端添加 /api/image-proxy 路由（类似 video-proxy，支持 download=1）
- [x] ImageGenNode 添加右侧输出 Handle（source type）
- [x] VideoTaskNode 添加左侧参考图输入 Handle（target type）
- [x] Canvas.tsx onConnect 回调：检测 image_gen→video_task 连线，自动将 imageUrl 填入 VideoTaskNode 的 referenceImageUrl
- [x] TypeScript 0 errors，测试全部通过

## Phase 18: 画布 UI 全面重设计
- [x] BaseNode：参考 Figma 卡片风格，圆角更大、阴影更柔、标题栏与内容区分离、无选中时无蓝色边框噪音
- [x] 选中状态：仅高亮边框+轻微阴影，不显示 ReactFlow 默认蓝色缩放手柄框
- [x] CustomEdge：更细更优雅的连线，hover 时才显示删除按鈕，动画更流畅
- [x] Handle 样式：更小更克制，仅 hover 节点时才显示，避免视觉噪音
- [x] 画布工具栏：重新设计为浮动胶囊式底部工具栏（参考 Figma），节点添加、缩放、适配等操作集中
- [x] 缩放控件：移除 ReactFlow 默认 Controls，改为自定义简洁按鈕组
- [x] 右键菜单：更现代的圆角卡片样式，图标+文字，分组分隔线
- [x] 节点内容区：内边距更宽松，字体层级清晰，操作按鈕统一高度
- [x] 整体背景：更细腻的点阵/网格背景，颜色更低调
- [x] TypeScript 0 errors，测试全部通过

## Phase 19: 滚轮交互修复 + 参数横向布局
- [x] BaseNode 内容区：hover 节点时阻止 wheel 事件冒泡，使滚轮滚动节点内容而非缩放画布
- [x] VideoTaskNode：模型参数面板改为 2 列横向网格，无需滚动即可看全所有参数
- [x] ImageGenNode：参数区已是横向 flex 布局，无需修改
- [x] StoryboardNode/PromptNode：参数区已是横向布局，无需修改
- [x] TypeScript 0 errors，测试全部通过

## Phase 20: 节点高度自适应 + 参数折叠 + 快捷键提示
- [x] 节点高度自适应：移除各节点固定 minHeight，改为内容驱动自动高度（nodeConfig 中 height 改为 undefined）
- [x] BaseNode：移除固定高度约束，内容区 overflow-auto 改为 overflow-visible
- [x] VideoTaskNode：模型参数区添加折叠/展开按鈕（默认展开，点击收起）
- [x] ImageGenNode：参数区添加折叠/展开按鈕
- [x] 底部工具栏：添加 "?" 按鈕，点击弹出快捷键速查浮层
- [x] TypeScript 0 errors，测试全部通过

## Phase 21: 节点未选中时自动折叠参数
- [x] BaseNode 将 selected 状态通过 NodeSelectedContext.Provider 传递给子节点
- [x] VideoTaskNode：selected=false 时自动折叠参数区，selected=true 时展开
- [x] ImageGenNode：selected=false 时自动折叠参数区，selected=true 时展开
- [x] TypeScript 0 errors，测试全部通过
