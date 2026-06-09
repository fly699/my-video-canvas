# 待修复清单（Known Issues / TODO）

> 用户确认「记入待修复、后续解决」的项目。修复时从这里取上下文。

## 1. Poyo 价格大量显示占位「模型页」，无真实点数 —— 待修复

**现象**：图像 / 视频节点里很多 **Poyo** 模型的点数标注是占位 `"模型页"`，没有真实数字
（kie 的已在 PR #368 按价格表补全，Poyo 还没）。

**范围（统计于 2026-06）**：
- 图像：`client/src/lib/models.ts` 中 `poyo_*` 用 `costNote: "模型页"` 的约 **13** 个。
- 视频：`client/src/components/canvas/nodes/VideoTaskNode.tsx` 中 `poyo_*` 用
  `costLabel: "模型页"` 的约 **22** 个。

**修复数据源**：`docs/poyo-credits-pricing.md`（仓库已存 Poyo 官方计费文档）。

**修复方案**（与 kie 同法）：对照 `docs/poyo-credits-pricing.md`，把每个 `poyo_*` 模型的
`costNote`（图像）/ `costLabel`（视频）从 `"模型页"` 换成真实点数（如「5 点/张」「12-18 cr/s」）；
文档里确实没有的再保留「模型页」。

**不阻塞功能**——仅显示问题。
