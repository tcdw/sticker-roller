# 生成链路与提示词语义

Web 和 CLI 共用同一条链路（`src/jobs/references.ts` + `src/db/repositories.ts` + `src/jobs/worker.ts`），差别只在参数来源与引用解析的宽松度。**改这里必须同时跑两边的测试**。

## 引用 token

提示词里可以写 Markdown 风格的引用，两个正则定义在 `src/prompt-tokens.ts`（纯 TS，前后端共享）：

```text
@[显示名](asset:<id>)     文本素材引用
![显示名](image:<id>)     参考图引用
```

| Token | 语义 | 提交时发生什么 |
| --- | --- | --- |
| 素材引用 | 引用一条 `assets` 行 | 素材正文作为文本块追加到展开后的 prompt 末尾 |
| 图片引用 | 引用一条 `uploads` 行 | token 被替换成该 upload 的 `name`（不一定是原始文件名——「存为图片素材」写的是 `结果图N`）；图片字节作为 provider content part 发送 |

- Web 提交器插入的永远是以 **id** 写的 token；CLI 允许写名字，但会在建 job 前规范成 id（`normalizeTokens`），所以库里存的两端一致。
- 显式引用集合等于「prompt 里出现的 token」∪「命令行 `--asset` / `--image`」，去重后**token 引用的排在前面**——这决定了 provider 收到参考图的顺序。
- **解析失败的处置两端不同**：
  - **CLI**：扫描 prompt 里的 token，解析不到即报错（退出码 2），歧义时给出候选名字列表。
  - **HTTP**：不扫描 prompt。`POST /api/jobs` 只接收 `referencedAssetIds` / `referencedImageIds`（必须是合法 UUID）并逐个解析它们；**prompt 里悬空的 token 不会被发现**，会原样入库并作为纯文本发给 provider。HTTP 侧的错误码恒为 `INVALID_INPUT`（引用失败也是它），`AMBIGUOUS` 只在 CLI 可达——API 的 `allowNames` 为 false，永远走不到按名字匹配那条分支。

## prompt 展开规则

`resolveJobInput()` 的输出就是入库的 `prompt_snapshot`：

```text
authored prompt（含 token）
   │  ① 每个图片 token → 该图片的 name（纯文本，引用图通过 content part 传）
   ▼
promptText
   │  ② 若有文本素材：追加 "\n\n" + 每个素材一块 "[<name>]\n<prompt 正文>"
   ▼
最终发送给 provider 的文本
```

- 素材正文**只对被显式引用的**素材追加，绝不自动附加所有素材。
- 三份东西都存库：`authored_prompt_snapshot`（原文）、`references_snapshot`（引用快照）、`prompt_snapshot`（展开结果）。想改「发给 provider 的内容」就改这里，不要改 authored。
- job 一落库即固化。之后改素材名、改素材正文、甚至归档素材，历史任务都不受影响。

## 单次生成

`src/generator.ts` 的 `generateSingleImage()`：

```text
参考图 content parts（顺序 = 引用顺序） + 文本
        │
        ▼
provider 调用（createProvider → 直连 Google 或 AI Gateway）
        │
        ▼
取 result.files 里第一个 image/* → base64 → Buffer
        │
        ▼
removeBackground ? sharp 洋红抠底 → PNG : 原图
```

- **背景抠图**：提示词会追加一段「背景必须是纯洋红 `#FF00FF`」的硬指令（`BACKGROUND_PROMPT_INSTRUCTION`），拿到图后按像素距离 + 洋红优势度算 alpha，输出 PNG。`removeBackground` 为 false 时**既不追加指令也不抠**。
- **`auto` 语义**：`auto` 表示「不向 provider 发送该字段」。`buildProviderImageConfig()` 会过滤掉它，`validateOptions()` 也不把它写进 `options_snapshot`，所以 `auto` 永远不会变成字符串发给 provider。
- **模型名映射**：直连模式与 Gateway 模式的模型 id 不同（如 `gemini-3-pro-image` vs `gemini-3-pro-image-preview`），映射在 `getModelId()`。新增模型要同时改 `src/image-options.ts` 的 `SUPPORTED_MODELS` / `MODEL_CAPABILITIES` 和这里的映射。
- 生成函数**只返回 buffer**，绝不决定落盘路径——路径由 worker 决定，这样测试才能注入假 generator。

## 队列执行

`GenerationWorker`（`src/jobs/worker.ts`）单条 item 的完整生命周期：

```text
claimNextItem（事务：queued → running，写 heartbeat）
   │
   ├─ 有已登记产出且文件仍在 output/ → completeRegisteredItem，结束（不再花钱）
   ├─ 历史尝试数 ≥ maxAttempts(3)    → finishItem(failed, 'maximum attempts exceeded')
   │
   ▼
startRequest（写 llm_requests.running，attempt = max+1）
   │  ← job 已取消时抛错，worker 直接返回，不产生真实调用
   ▼
每 15s updateHeartbeat
   │
   ▼
generator → 写 `<final>.<itemId>.tmp` → rename 成 `<jobId>-<ordinal>.<ext>`
   │
   ▼
finalizeRequest（成功：登记 generated_files；失败：safeError 后写 error）
   │
   ▼
refreshJob（重算 job 计数与状态） + item.<status> 事件
```

关键边界：

- **临时文件 + rename**：避免半截文件被登记。异常时 `unlink` 临时文件（失败吞掉）。
- **取消竞态**：取消只作用于 queued 与「running 但没有 running request」的 item。已发出的请求必须跑完，其结果按正常路径落终态。
- **错误脱敏**：`safeError()` 抹掉 http(s) URL 与 `authorization` / `x-api-key` / `bearer …` 等形态的值，截断到 500 字符后才入库。**不要删掉这层**，否则 provider 的报错可能把密钥写进数据库并显示在 UI 上。
- **stale 恢复**：只发生在 `start()`（进程启动）时，把心跳过期的 running item 打回 queued。CLI 的 `runGeneration` **不做**恢复——它只排空自己的 job，不能改写别人的状态。

## 变动检查清单

改引用 / 生成语义时逐条过：

1. `src/prompt-tokens.ts` 的正则与提取函数（前端打包的也是这份）。
2. `src/jobs/references.ts` 的解析优先级：**精确名字（忽略大小写）→ 唯一片段**，多个精确匹配也算歧义。
3. Web 与 CLI 两处调用点（`server/api.ts` 的 `POST /api/jobs`、`src/cli-run.ts` 的 `runGeneration`）。
4. `options_snapshot` 的形状与 `web/src/api.ts` 的 `optionsFromSnapshot()`（历史任务复用时按它还原参数）。
5. 测试：`server/api.test.ts`、`src/jobs/worker.test.ts`、`src/cli-run.test.ts`、`web/src/api.test.ts`。
