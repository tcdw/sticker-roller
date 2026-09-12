# 设计原文归档（只读）

这里是**历史设计原文**的存放处，不是当前实现的说明书。内容按当时的日期冻结，**不要改写**；发现与现状不符时，改的是 `agent-doc/` 正文，不是这里。

## 内容

| 路径 | 是什么 | 现状 |
| --- | --- | --- |
| [web/README.md](web/README.md) | Web 工作台的素材引用契约修正案（asset ≠ prompt） | 语义已实现，见 [../generation-flow.md](../generation-flow.md) |
| [web/workspace-layout.md](web/workspace-layout.md) | 工作台布局、交互与响应式契约 | 已实现，见 [../web-ui.md](../web-ui.md) |
| [plan/](plan/) | docs-sprint 的 delivery plan：analysis / tasks / reviews | 已全部交付，结论已吸收进正文 |
| [plan/backlog.md](plan/backlog.md) | **未完成事项**清单 | 仍然是 pending 工作的真实来源 |
| [image-provider-directions-2026-09-12.md](image-provider-directions-2026-09-12.md) | OpenAI Images 直连与统一 OpenRouter 两条候选路线、取舍及验证计划 | **待定案、未实施**；不是当前 provider 配置 |
| [ai-gateway-integration.md](ai-gateway-integration.md) | AI Gateway 接入调研（为什么走 Vercel 路由） | 结论有效；文中「代码结构」一节已过时 |

## 阅读时的注意事项

- 文件里的**行号锚点与「当前实现」描述停留在当时的代码版本**，链接虽然可达，但锚点位置可能已经漂移。要确认现状请读源码。
- `plan/reviews/` 是当时的评审记录，里面的「blocked / P1 / P2」是**历史结论**，不代表当前的缺陷清单。
- 归档内的相对链接已按移动后的位置修正（只改了 `../` 深度与两处指向本目录新位置的标签），正文一字未改。
- [ai-gateway-integration.md](ai-gateway-integration.md) 里含公司内网网关域名（token 是占位符，无真实凭证）。该内容在本次归档之前就已提交进仓库历史，归档按约定不改写，先在此标注；若要清理，需要单独决定是否重写历史。

## 当前状态去哪里看

| 想了解 | 去哪 |
| --- | --- |
| 现在怎么跑、怎么验证 | [../../AGENTS.md](../../AGENTS.md) |
| 当前架构与不变量 | [../architecture.md](../architecture.md) |
| 还没做的事 | [plan/backlog.md](plan/backlog.md) |
