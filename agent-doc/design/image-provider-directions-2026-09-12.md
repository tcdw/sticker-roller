# 图片生成后端：OpenAI 直连与统一 OpenRouter

- 记录日期：2026-09-12
- 代码基线：`9dc8e4b`
- 状态：**两条候选路线，尚未定案、尚未实施**
- 授权范围：归档本次讨论并提交文档；不是实现授权，也不是付费生成授权。

本文冻结当时的调查与取舍，不是当前运行配置说明。当前实现仍见 [配置](../configuration.md) 和 [生成链路](../generation-flow.md)。后续定案应新增记录，不把本候选方案改写成已经实现的事实。

## 目标与共同约束

目标是接入 GPT Image 2.5 等 OpenAI 图片模型，同时考虑是否将现有 Gemini 也统一到 OpenRouter。

已经确认的约束：

- endpoint 与密钥仅通过环境变量配置，不增加 Web 凭证设置页。
- OpenAI 只使用原生透明背景：不追加洋红背景指令、不本地抠底、不失败后自动降级。
- Gemini 保留现有洋红提示与本地抠底行为。
- 保留素材引用、任务快照、持久化队列、Web/CLI 共享校验和历史复用。
- 每个 item 只生成一张图片，`count` 仍对应多个 item，不把单请求 `n` 批量生成引入状态机。
- 不为了验证调用真实 provider；真实账户、图像质量与透明边缘验收需要另行授权。
- 不改变网络监听、鉴权边界、引用解析差异或队列取消/恢复语义。

## 方向 A：保留 Google/Gateway，新增 OpenAI Images 适配

### 选择理由

优先保留原厂参数能力和已有渠道，减少对聚合服务模型上线、参数转译的依赖。代价是继续维护多套传输、凭证和账单。

### 拟议契约

- Google 继续沿用现有 `AI_GATEWAY_URL` + `AI_GATEWAY_TOKEN` 优先，否则使用 `GEMINI_API_KEY` 的路由。
- 新增 `OPENAI_API_KEY` 与可选 `OPENAI_BASE_URL`，默认 API 根前缀为 `https://api.openai.com/v1`。按模型家族选择路由，不把 OpenAI 送进 Google Gateway 分支。
- 无参考图使用 `/images/generations`；有参考图使用 `/images/edits`。参考图来自既有本地库，保持顺序，不引入远程图片抓取或 Files API。
- 候选依赖为 `@ai-sdk/openai@3.0.112`，配合已有 `ai@6.0.49` 的 `generateImage()`。调查确认发布包使用 ImageModelV3，支持自定义 `baseURL`/`fetch`；仍需安装后的类型检查和 mock 协议测试，不能把源码核对当作兼容性验收。
- 首批候选模型为 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`；`gpt-image-2` 可作为附加候选，官方透明支持当时标为 preview。`gpt-image-2.5` 本身不是此次核实的官方模型 ID。
- `removeBackground=true` 对 OpenAI 发送 `background=transparent`、`output_format=png`；false 发送 opaque。禁用洋红提示和后处理，透明不支持则明确失败。
- GPT Image 使用 base64 返回，不发送 `response_format`。无图、格式无效或不可解码结果不能成功登记。

### 参数与校验

- 保留 Gemini 的 `aspectRatio` 与 `imageSize=1K/2K/4K`；OpenAI 新增像素 `size` 和 `quality`，不重载旧字段。A 中 OpenAI 不接收显式 `aspectRatio`，不静默将比例换算成像素。
- 2.5 质量候选：low/medium/high/xhigh/max；2 为 low/medium/high。auto 表示省略字段。
- 2.5 官方尺寸边界调查结果：宽高均为 16 的倍数，单边不超过 3840，长短边比不超过 3，总像素 655,360–8,294,400；超过 3,686,400 像素标为实验性。实施时复核，不把这些限制直接套到其他模型或 OpenRouter。
- 2 首版可只开放 1024x1024、1536x1024、1024x1536，避免混用不同模型的自定义尺寸边界。
- 显式传入不属于所选模型的尺寸/质量字段应报错，不静默丢弃；模型切换与历史复用需要清理不兼容值。
- OpenAI 参考图上限 16；展开后的 prompt 上限 32,000 字符。保留项目已有更严格的 authored prompt 和上传限制，在引用解析后、createJob 前共享校验。

### 主要风险

自定义 endpoint 必须兼容 OpenAI Images API，包括 multipart edits 与 base64 返回；仅兼容 Chat Completions 或只返回图片 URL 不够。原厂与兼容代理的透明支持和质量也不能一概而论。

## 方向 B：所有图片模型统一 OpenRouter

### 选择理由与当前建议

**本次技术建议更倾向 B，但用户尚未选择。** 本项目以多模型出图为主，统一请求、密钥和账单可以减少维护成本；仍然保留模型能力差异，而不是把所有参数统一成同一个可用集合。

### 协议不是更换 OpenAI base URL

OpenRouter 当前提供 `POST https://openrouter.ai/api/v1/images`，用同一 JSON 接口处理文生图和参考图生成。它不同于方向 A 的 generations/edits 路径，不能直接套用 OpenAI SDK 的 Images 路由。

建议新增小型服务端 `openrouter-image-provider` 模块，直接使用 Bun `fetch`：

- 环境变量为 `OPENROUTER_API_KEY` 和可选 `OPENROUTER_BASE_URL`，默认根前缀为 `https://openrouter.ai/api/v1`。自定义 endpoint 必须兼容该协议。
- 请求传入模型映射、prompt、`n=1` 和已校验参数，不启用 SSE。
- 参考图用 `input_references`，元素为 `{ type: 'image_url', image_url: { url: 'data:<mime>;base64,<bytes>' } }`，保持原始顺序。
- 结果读取 `data[].b64_json`；`media_type` 可缺省，必须检查实际字节。只接受项目支持的 PNG/JPEG/WebP，不扩展到 SVG，也不盲猜 MIME。
- 选定 B 并完成迁移后，再删除原 Google/Gateway 调用和无引用的 SDK；不先安装方向 A 的 OpenAI SDK，也不长期保留三套后端作为默认目标。

### 当日端点能力

下表来自 2026-09-12 的公开只读端点查询，不是账户可用性或真实生成测试。

| OpenRouter 模型 ID | 原生透明声明 | 参考图上限 | 限制 |
| --- | --- | --- | --- |
| `openai/gpt-image-2.5-flare` | transparent | 16 | quality 包含 xhigh/max；当时只有 OpenAI 一个上游 |
| `openai/gpt-image-2.5-sunburst` | transparent | 16 | 同上 |
| `openai/gpt-image-2` | 仅 auto/opaque | 16 | 不得套用原厂透明 preview 的结论；B 首版建议暂不纳入 |
| `google/gemini-3-pro-image` | 未列出 | 14 | AI Studio 支持 1K/2K/4K；Vertex 仅 1K/2K |
| `google/gemini-3.1-flash-image-preview` | 未列出 | 14 | 端点仍可查询；AI Studio 支持 512/1K/2K/4K |
| `google/gemini-3.1-flash-image` | 未列出 | 14 | 目录列出的正式版，不自动替换旧 preview 任务 |

首批建议为现有两个 Gemini 和两个 GPT Image 2.5。Gemini 继续洋红抠底；2.5 发送 transparent/opaque 和 PNG，绝不洋红降级。

### 参数与上游选择

- Gemini 映射 `aspectRatio → aspect_ratio`、`imageSize → resolution`，保留 auto 省略语义。
- OpenRouter 的 2.5 支持 `aspect_ratio`，可共用比例控件；方向 A 的“OpenAI 不接收显式比例”规则在 B 中不适用。
- quality 必须按正式请求 schema 和端点能力判断：概览只列到 high，但 2.5 端点及请求 schema 已列 xhigh/max。
- 精确尺寸仍单独使用 `size`。正式 API 支持像素 size，但 2.5 端点元数据没有完整列出 size/output_format/resolution；不能照搬原厂所有 4K/custom 组合并宣称已验证。B 首版可先做自动尺寸、比例和质量，精确尺寸待独立验收后开放。
- 显式像素尺寸与比例/档位冲突时本地报错，不依赖上游 400、参数忽略或比例 clamp。
- 模型目录的能力是端点并集；不能把它当作每个上游都具备的能力。首版使用已核对的本地白名单，不把在线目录全部自动开放给 UI。
- 建议固定 `provider.only` 并设置 `allow_fallbacks=false`：2.5 为 `openai`，Gemini Pro 为 `google-ai-studio/global`，Flash Preview 为 `google-ai-studio`。以后只对等能力上游显式开放 fallback。
- 不把聊天 API 的 require_parameters/zdr 等字段未经核对直接视作 Image API 支持。

### 存量任务迁移

保留应用内的 `gemini-3-pro-image` 与 `gemini-3.1-flash-image-preview`，仅在适配器映射为 `google/...`。旧快照无需改写或数据库迁移；新增字段必须完整透传。

切换后，尚未完成或重试的历史任务会经 OpenRouter 处理。实施前应说明这一变化、排空在途任务或停止 worker 后再切换；不能暗中把 preview 升级成正式版。新任务统一校验 Google 14 张、GPT 2.5 16 张的参考图限制；存量超限任务也在请求前明确失败，不能截断引用。

## 两条方向的取舍

| 关注点 | A：原厂/兼容 Images + 现有 Google | B：统一 OpenRouter |
| --- | --- | --- |
| 维护量 | 多套请求、凭证、账单 | 一套传输，仍有模型能力表 |
| 参数覆盖 | 原厂能力最直接 | 依赖平台转译、白名单和上线节奏 |
| 故障隔离 | 可独立使用不同渠道 | 平台故障、余额或风控可能影响全部模型 |
| 成本 | 按所选渠道 | 官方称推理不加价，但充值有平台费 |
| 数据路径 | 原厂或已有网关 | 多经过 OpenRouter 一个处理方 |
| 自定义 endpoint | 需兼容 OpenAI Images 协议 | 需兼容 OpenRouter Images 协议 |

OpenRouter 官方成本说明提到充值费 5.5%；具体支付方式、最低费和套餐以结算页为准，不承诺比原厂便宜。每图成本随输入图、尺寸、质量和上游变化，不把文档示例单图价格当报价。

官方称默认不保存 prompt/response 内容，但会保存请求元数据，上游另有保留/训练政策；这不等于数据不经过 OpenRouter，也不等于所有上游都满足同一隐私要求。

两条路线都不改变本地 durable queue。当前取消不会中断在途 HTTP 请求；OpenRouter 关于失败/未完成取消的计费说明，不代表本应用的取消按钮能退费。适配器不自行重试；超时也不能证明上游没有完成，无法解决“生成成功但登记前崩溃”的重复调用窗口。

## 接入位置与执行顺序

代码锚点停留在记录时版本：

| 模块 | 接入工作 |
| --- | --- |
| [src/generator.ts:80](../../src/generator.ts#L80) | 替换/扩充 provider 路由；保留 [SingleImageResult](../../src/generator.ts#L128) 与 Google 抠底，分离 OpenAI 原生透明 |
| [src/image-options.ts:24](../../src/image-options.ts#L24) | 前后端共享纯 TS 能力表，不引入 SDK 或环境变量 |
| [src/jobs/options.ts:12](../../src/jobs/options.ts#L12) | 新字段白名单、模型冲突和引用解析后输入限制 |
| [server/api.ts:231](../../server/api.ts#L231)、[src/cli-run.ts:172](../../src/cli-run.ts#L172) | 两入口共享校验后再 createJob |
| [cli.ts](../../cli.ts)、[src/cli-spec.ts](../../src/cli-spec.ts) | 新 flag、模型枚举、帮助和环境变量契约 |
| [src/jobs/worker.ts:160](../../src/jobs/worker.ts#L160) | snapshot 新字段透传；保留状态迁移、心跳和脱敏 |
| [web/src/api.ts:32](../../web/src/api.ts#L32)、[web/src/main.tsx](../../web/src/main.tsx) | 参数控件、模型切换归一化、历史复用 |
| [src/db/schema.ts:42](../../src/db/schema.ts#L42) | options 为 JSON 文本，本范围无需迁移 |

未来实施顺序：

1. 用户选择 A 或 B，明确首批模型和精确尺寸范围；复核有时效性的端点能力。
2. 记录测试基线，先实现可注入 env/fetch 的协议适配器和 mock 测试。
3. 完成共享能力、输入限制与 HTTP/CLI/snapshot/worker 全链路字段透传。
4. 接入 generator 的路由和背景策略，完善 Web 控件与复用。
5. 同步配置、架构、生成链路、CLI、Web 和 operations 文档；B 在此时删除不再使用的旧依赖/路由。
6. 运行回归并报告实际结果。真实出图仅在另行授权后执行，不能以文档或 mock 结果冒充生成质量验收。

## 验证计划

实现阶段运行 `bun test`、`bun run typecheck`、`bun run build`、`bun run check`、`bun run cli -- help --json`。`check` 的既有问题以当次基线为准，不顺手改生成的迁移快照。

mock 测试至少覆盖：

- 自定义根前缀、非法 URL、缺密钥；密钥/URL 不出现在快照、浏览器或错误日志。
- A 的 JSON generations 与 multipart edits，或 B 的统一 JSON `/images`；n=1、参考图 MIME/字节/顺序正确。
- 质量、比例/尺寸、auto、背景准确传递；不支持和冲突参数先于建任务失败。
- 2.5 原生透明不带洋红指令、不抠底；Google 背景行为回归。
- 空图、非 JSON、无效 base64、非图片、错误响应与网络超时安全失败，不触发隐藏重试。
- HTTP/CLI 对等快照和输入限制、旧任务复用、模型切换清理字段、worker 完整透传、取消/恢复和脱敏。
- B 额外覆盖固定上游、4K 能力差异、14/15 与 16/17 张边界、preview 模型映射。

真实验收待授权：2.5 文生图透明、参考图透明、Gemini 洋红抠底与 4K，检查实际 alpha/边缘/像素尺寸。隔离探测数据库、输出与日志到仓库 `.temp/`，不要写入用户真实任务历史。

## 待定事项与证据边界

- 用户尚未选择路线；“更倾向 B”是技术建议，不是已接受决策。
- 首批模型是否包含 GPT Image 2、是否首版开放精确像素尺寸尚需随最终路线确认。
- SDK 运行时兼容性、自定义代理、OpenRouter 账户与真实透明效果都未经付费调用验证。
- 本记录基于先前只读源码调查、官方文档、SDK 发布包与 OpenRouter 公开模型 GET；未修改业务代码、安装依赖或生成真实图片。

## 调查来源

以下链接记录当日依据，内容可能随服务更新而变化：

- OpenAI：[图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)、[生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate)、[编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit/)、[尺寸与提示指南](https://developers.openai.com/api/docs/guides/image-prompting)。
- AI SDK：[OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai#image-models)、[generateImage](https://ai-sdk.dev/docs/ai-sdk-core/image-generation)。
- OpenRouter：[图片生成指南](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)、[请求 schema](https://openrouter.ai/docs/api/api-reference/images/generate-an-image)、[端点 schema](https://openrouter.ai/docs/api/api-reference/images/list-endpoints-for-an-image-model)。
- OpenRouter 模型端点：[Flare](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.5-flare/endpoints)、[Sunburst](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.5-sunburst/endpoints)、[GPT Image 2](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2/endpoints)、[Gemini Pro](https://openrouter.ai/api/v1/images/models/google/gemini-3-pro-image/endpoints)、[Flash Preview](https://openrouter.ai/api/v1/images/models/google/gemini-3.1-flash-image-preview/endpoints)、[Flash](https://openrouter.ai/api/v1/images/models/google/gemini-3.1-flash-image/endpoints)。
- OpenRouter：[费用 FAQ](https://openrouter.ai/docs/faq#pricing-and-fees)、[成本说明](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/)、[数据收集](https://openrouter.ai/docs/guides/privacy/data-collection)、[上游隐私](https://openrouter.ai/docs/guides/privacy/provider-logging)。
