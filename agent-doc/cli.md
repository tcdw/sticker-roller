# CLI

`bun run cli -- <args>`。默认命令是 `generate`，所以 `bun run cli -- --prompt "…"` 就是生成。

**唯一真相源是 `bun run cli -- help --json`**，不是本页。本页解释设计与不变量；参数、枚举、默认值、退出码一律以 spec（`src/cli-spec.ts`）为准。

## 添加或修改命令

`src/cli-spec.ts` 是声明式的：命令、positional、flag、枚举取值、互斥、示例全写在一个数组里。`src/cli-parse.ts` 按它解析 argv，`src/cli-help.ts` 按它渲染 human / JSON help。

因此**只改 spec 一处**：新增 flag 时不会出现「help 里写了、解析器里没有」的漂移；`src/cli-spec.test.ts` 正是在守这条自洽性。新增命令时记得同时接上 `cli.ts` 的 `dispatch` switch。

几条硬规则：

- `--help` 优先于此行的一切，永远退出 0。
- group 下的未知子命令（如 `asset foo`）报错，**不会**静默回退去生成图。
- 没有参数时退出码 2 并打印 help——绝不「什么都不做却退出 0」，agent 会把它读成生成成功。

## 渠道与专属参数

`--provider` 明确渠道、`--model` 明确其模型，重复 `--option name=value` 表达专属字段，`--background` 指定支持的背景策略。模型/字段白名单来自 `src/image-providers/catalog.ts`，help JSON 的 `imageProviders` 可发现全部能力。

旧 `--aspect-ratio`、`--image-size`、`--no-remove-background` 保留为兼容别名；与专属字段/背景冲突时报用法错误，不覆盖。重复 option key、未知 key、非法布尔/非有限数字都被拒绝。未指定 provider 时按旧环境优先级选择，建任务时固定到 v2；配置错误退出 1，不创建任务。

## 输出契约

| 流 | 内容 |
| --- | --- |
| stdout | **只有数据**：生成命令一行一个绝对路径；查询命令输出表格，`--json` 时输出单个 JSON 文档 |
| stderr | 进度、警告、错误（`error: CODE: message` + 可选 `hint:` 行）、最终统计 `job <id>: N succeeded, M failed` |

`--json` 与人类可读文本**永不混流**。调用方（尤其 agent）应当从 stdout 取结果，不要把两个流一起正则。

## 退出码

| 码 | 含义 | 典型处理 |
| --- | --- | --- |
| 0 | 成功 | 继续 |
| 1 | 运行时错误（数据库、迁移、provider、写文件） | 不是提示词的问题，别改 prompt |
| 2 | 用法错误（未知 flag、非法取值、引用无法解析或有歧义） | 改命令行后重跑，候选名单在 stderr |
| 3 | 生成结束但有 item 失败 | 成功的那几张仍已在 stdout，可先看图 |

映射实现见 `cli.ts` 的 `exitCodeFor()` / `errorCodeFor()`：`CliError` 的 `USAGE` / `NOT_FOUND` / `AMBIGUOUS` 归 2，`PARTIAL_FAILURE` 归 3，其余归 1；裸 `InputError` 一律算用法错误。

## 引用解析：CLI 比 API 宽松

CLI 允许写**名字**和**本地路径**，API 只接受 id。差别集中在 `src/cli-run.ts`，解析规则本身在 `src/jobs/references.ts`：

| 输入 | 行为 |
| --- | --- |
| `--asset 角色设定` | 精确名字（忽略大小写）→ 唯一片段；多个候选报 `AMBIGUOUS` 并列出名字 |
| `--image ./ref.png` | 本地文件**优先**：先看路径是否存在，存在就按上传校验并入库存成新的 upload |
| `--image <uuid>` | 直接当 upload id 解析，要求未归档 |
| `--image 头像` | 走库内名字解析 |

prompt 里的 token 会在建 job 前被 `normalizeTokens()` 规范成 id 形态：方括号里放名字，圆括号里写 `asset:` 或 `image:` 加 UUID，所以 Web 和 CLI 落库的形状完全一致。

## 与 Web 的关系

- 同一个 SQLite、同一份素材库，CLI 生成的任务**会出现在 Web 任务历史里**（用户能看见）。
- CLI 用 `worker.runOnce(jobId)` 只排空自己刚建的 job，所以服务进程在跑时也可以执行 CLI，不会互抢任务。
- CLI 不做 stale 恢复（不碰别人的状态），也不接管常驻循环。

## 已知边界

- `src/cli-query.ts` 的表格是纯文本对齐，宽度按字符数算，宽字符（中文）视觉上会错位——这是显示问题，`--json` 不受影响。
- `--out` 只影响文件落点，不改变库里的 `generated_files.file_name`（始终是 `<jobId>-<ordinal>.<ext>`）。
