# 验证

本页记录本仓库特有的验证手段。通用命令见 [../AGENTS.md](../AGENTS.md) 的 Build/Test/Development 一节。

## 推荐验证

改动类型决定验证深度。**不要**用真实 provider 验证——每次调用都真实付费并写进用户的 Web 任务历史。

| 改动面 | 必跑 | 额外 |
| --- | --- | --- |
| 任意 TS 改动 | `bun run typecheck` | — |
| 领域层 / 状态机 | `bun test` | — |
| HTTP 契约 | `bun test server/api.test.ts` | 起服务后 curl 实际端点 |
| CLI 行为 | `bun test cli.test.ts` | `bun run cli -- help --json` 对照 spec |
| 前端 | `bun run build` | 起服务看 `dist/` 是否被正确服务 |
| schema / 迁移 | `bun run db:generate` 后**提交生成文件** | 用临时 DB 起一次服务确认 migrate 通过 |

起服务做端到端探测时，把探测数据隔离到 `.temp/`，不要动用户真实资产：

```bash
DATABASE_PATH=.temp/probe.sqlite OUTPUT_DIR=.temp/out PORT=3199 bun run server/index.ts
curl -s http://127.0.0.1:3199/api/health          # {"ok":true}
curl -s http://127.0.0.1:3199/api/assets          # 空库返回 []
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3199/   # 200（需先 bun run build）
```

失败恢复验证（stale recovery / 取消竞态）不需要真的杀进程：`createWorker` 支持注入 `heartbeatMs` / `staleAfterMs` / `maxAttempts`，`src/jobs/worker.test.ts` 就是这么构造这些场景的。

## 测试布局

| 测试文件 | 主要契约 |
| --- | --- |
| `cli.test.ts` | 命令分发、退出码、stdout/stderr 分流、引用报错格式 |
| `src/cli-spec.test.ts` | spec 自洽：help 里出现的 flag 必须能被解析，反之亦然 |
| `src/cli-run.test.ts` | token 规范化、本地图片入库、按 jobId 排空、结果路径 |
| `src/cli-query.test.ts` | 名字/片段解析与歧义候选、archived 过滤 |
| `server/api.test.ts` | HTTP 路由与状态码、错误 envelope 措辞、上传校验、分页 |
| `src/db/repositories.test.ts` | 状态迁移合法性、非法迁移抛错、取消与重试、stale 恢复 |
| `src/jobs/worker.test.ts` | 参数透传、取消边界、脱敏、注册产出复用、job 隔离 |
| `src/image-options.test.ts` | 模型能力回退到 `auto` 的规则 |
| `web/src/api.test.ts` | 快照还原、分页纯函数、prompt token 提取、未引用图片检测 |

## 既有失败

不要预设 `tsc` / lint 处于失败状态。**先跑，再判断。**

截至建立本页时：(先跑一遍确认现状，不要照抄结论)

- `bun test`：全绿。
- `bun run typecheck`：通过。
- `bun run check`：**有既有失败**。2 个 format error 位于 `drizzle/meta/*.json`（drizzle-kit 生成的快照，不应手改）；另有约 60 条 lint warning，主要是 `lint/style/noNonNullAssertion`（集中在测试文件）与少量 `noExplicitAny`。

因此 `bun run check` 目前**不能**作为「改动是否干净」的判据。判断标准改为：本次改动没有新增 diagnostics（对比改动前后的同一份输出），并且没有碰 `drizzle/meta/`。

遇到与本次改动无关的失败，在最终回复里说明是既有问题，但不要因此跳过验证。

## 结果记录

最终回复应区分三类结果：

- **已通过**：例如「`bun test` 93 pass / 0 fail；`bun run typecheck` 无输出」。
- **已执行但被既有问题阻塞**：说明具体错误与它属于既有问题的依据。
- **未执行**：说明原因（如需要真实 provider、需要用户机器上的端口），不要写成通过。

涉及真实 provider 的路径（实际生成一张图）属于「未执行」——除非用户明确要求，不要为了验证它花钱。
