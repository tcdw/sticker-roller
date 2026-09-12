# Agent Documentation

本目录存放面向 AI agent 的项目知识。根目录 [../AGENTS.md](../AGENTS.md) 是统一入口；这里的文档按任务主题拆分，避免每次加载完整设计。

## 使用方式

1. 先读 [../AGENTS.md](../AGENTS.md) 的项目约束与「Where to Look」。
2. 根据任务只读取相关主题文档，不要一次全读。
3. 以当前源码、迁移和配置 schema 为最终事实；设计文档用于理解范围与意图。
4. 行为或运维契约改变时，同步更新对应主题文档和本索引。

## 快速入口

| 任务 | 文档 |
| --- | --- |
| 理解进程组成、模块职责、并发与恢复语义 | [architecture.md](architecture.md) |
| 改表结构、状态机、job/item 迁移逻辑 | [data-layer.md](data-layer.md) |
| 改生成链路、引用 token、prompt 展开规则 | [generation-flow.md](generation-flow.md) |
| 加/改 CLI 命令、flag、输出或退出码 | [cli.md](cli.md) |
| 改前端工作台、轮询、复用历史任务 | [web-ui.md](web-ui.md) |
| 加环境变量、切 provider、查密钥名 | [configuration.md](configuration.md) |
| 起服务、排障、处理长期进程 | [operations.md](operations.md) |
| 跑测试、判断既有失败、验收改动 | [verification.md](verification.md) |
| 查历史设计原文与已完成计划 | [design/](design/) |

## 文档边界

- `../AGENTS.md`：稳定入口、仓库规则、命令和主题目录。
- 本目录正文：当前实现的可检索知识与故障处理。与源码冲突时以源码 / 迁移 / 配置 schema 为准，然后修文档。
- `design/`：产品与技术设计原文，只归档、不改写、不作为运行状态记录。
- 测试：可执行的行为契约。文档与测试冲突时，先核对源码和最近迁移，再修正文档或实现。

## 与历史文档的关系

`design/plan/` 是已经跑完的 docs-sprint（develop / review / merge 循环）过程产物，其结论已经吸收进本目录正文：

| 历史结论 | 现状 |
| --- | --- |
| worker 契约、取消边界、重试语义 | [architecture.md](architecture.md)、[generation-flow.md](generation-flow.md) |
| 表结构与迁移策略 | [data-layer.md](data-layer.md) |
| asset 引用语义（token 而非替换正文） | [generation-flow.md](generation-flow.md) |
| shadcn 工作台布局与交互 | [web-ui.md](web-ui.md)、[design/web/](design/web/) |
| 文件夹式 CLI 被移除 | [cli.md](cli.md) |

`design/plan/backlog.md` 仍是**未完成事项**的真实来源，规划新工作时读它。
