# 路线三定案：图片生成防腐层与渠道专属选项

- 日期：2026-09-12
- 代码基线：`72412b4`
- 决策状态：**用户已选择路线三作为长期维护主线**。
- 实施状态：**尚未实施**。本次仅保存文档，下一 session 收到开工指令后再实现。
- 历史备选：[OpenAI 直连与统一 OpenRouter](image-provider-directions-2026-09-12.md)。两路线原文保留，不再作为当前推荐方向。

本文是独立可读的定案与开工交接，不依赖旧会话或会话外草稿。架构方向已确认；下文标注为“建议”的类型名、文件拆分、CLI 语法等属于实施提案，不代表用户逐项确认。后续如需变更架构决策，新增记录，不改写本定案历史。

## 1. 已确认的目标与范围

用户希望项目内部有防腐层，持续接入不同图片生成 API，并在提示词输入框下方显示当前 provider 的专属选项。

已确认：

1. **provider 表示 API 接入渠道，不是模型厂商**。同一模型可经不同渠道调用，参数能力不一定相同。
2. **在代码中注册 TypeScript adapter**，不是用户仅填 JSON/模板即可接入的插件平台。
3. 首批覆盖 **Google 直连、现有 AI Gateway、OpenAI Images、OpenRouter Images**。
4. **统一任务与结果契约，保留渠道/模型的参数差异**，不强迫所有 API 兼容 OpenAI。
5. endpoint、key 仍仅由环境变量配置；不做 Web 凭证编辑器。
6. OpenAI 透明输出只使用原生透明，不洋红提示、不本地抠底、不失败后静默降级。Gemini 保留现有洋红抠底。
7. 保留素材引用、快照、durable queue、Web/CLI 对等能力；每 item 一张图。

选择理由：路线一持续增加原厂分支，路线二将统一能力依赖于 OpenRouter。路线三让这些渠道都成为可替换适配器，在承担一次跨端配置迁移的前提下，将后续新 API 的修改尽量限制在定义、adapter 和测试内。OpenRouter 只是其中一个 adapter，不再是系统必须依赖的底座。

## 2. 新 session 开工入口

先读 [AGENTS.md](../../AGENTS.md)，再读 [架构](../architecture.md)、[生成链路](../generation-flow.md)、[数据层](../data-layer.md)、[配置](../configuration.md)、[CLI](../cli.md)、[Web UI](../web-ui.md)、[验证](../verification.md)。这些说明当前实现；本文说明目标实现，不能混淆。

开工顺序：

1. 查看 Git 状态，保护用户未提交变更。本归档本身可能尚未提交，不据此推断工作区应当干净。
2. 跑测试/类型检查记录基线，不读取凭证值、不进行真实生成。
3. 核对本文件的源码锚点和外部 API 能力；外部模型、SDK 版本与参数均可能变化。
4. 先完成共享契约、legacy/v2 解码与现有渠道搬迁，再增加 OpenAI/OpenRouter，最后接 UI。
5. 实施阶段维护独立任务清单并记录实际验证；不要用归档里的历史测试数冒充新结果。

本轮授权仅为文档保存。**不要仅凭这份文档自行生成真实图片、修改凭证、启动长期服务、commit 或 push**；后续操作按新 session 的用户指令执行。

## 3. 分层与命名

```text
Web / CLI
  ↓ provider + model + 专属 options
共享定义与边界校验
  ↓ 版本化配置快照
SQLite jobs/items → worker
  ↓ 一次生成命令
生成编排 / 防腐层
  ├─ Google 直连 adapter
  ├─ 现有 AI Gateway adapter
  ├─ OpenAI Images adapter
  └─ OpenRouter Images adapter
  ↓ 已验证图片字节 + MIME / 脱敏领域错误
现有落盘、登记、状态迁移
```

三个概念不能混用：

- `providerId`：应用内渠道，如 google、ai-gateway、openai、openrouter。
- `modelId`：该渠道定义下的模型；不能由厂商前缀推断所选渠道。
- 上游路由：例如 OpenRouter 的 AI Studio/Vertex，属于 adapter 内部明确的能力/路由策略，不扩成全局 provider。

adapter 负责认证、URL/协议、模型与字段转换、响应解析和错误转换；**不操作数据库、不决定输出路径、不领取任务**。生成编排负责背景策略；worker 不包含按厂商分支。

当前接缝：

| 位置 | 现状与变化 |
| --- | --- |
| [generator.ts:80](../../src/generator.ts#L80) | env 隐式选择 Gateway/Google，迁为明确 adapter 路由 |
| [generator.ts:128](../../src/generator.ts#L128) | SingleImageResult 是领域返回接缝；可保留或收紧成结果联合类型，不能让上游 SDK 类型泄漏给 worker |
| [image-options.ts:24](../../src/image-options.ts#L24) | 模型能力只有比例/档位，扩展为 provider+model 定义 |
| [jobs/options.ts:12](../../src/jobs/options.ts#L12) | 校验重新构造扁平白名单，必须同步支持新结构 |
| [worker.ts:160](../../src/jobs/worker.ts#L160) | 逐字段提取选项，改成完整已解码配置传递 |
| [schema.ts:42](../../src/db/schema.ts#L42) | optionsSnapshot 是 JSON 文本，首批范围无需新增数据库列 |

## 4. 双注册表与有限字段定义

建议目录布局，可随仓库惯例小幅调整：

- `src/image-providers/contracts.ts`：共享类型、有限字段描述类型。
- `src/image-providers/definitions/`：渠道/模型选项、默认值、输入限制、背景能力、跨字段规则。
- `src/image-providers/catalog.ts`：静态注册定义，Web/CLI 共用。
- `src/image-providers/server/`：真实 adapter、配置读取、服务端注册、配置可用状态。
- 保留 [src/generator.ts](../../src/generator.ts) 为生成编排；必要时抽出已有洋红算法，不能顺手改变其效果。

共享定义不得 import SDK、React、环境配置或 node 模块。服务端注册表绑定定义和强类型实现；测试保证二者一一对应。

字段种类先限定 select/boolean/number 和确实需要的受限文本（例如像素尺寸）。复杂组合用纯 TS 函数校验，不发明表达式 DSL，不引入通用 JSON Schema 表单引擎。

枚举/范围可为前端控件和后端校验共用；展示 label/group 与验证职责分离。服务端完整校验始终是权威，不能把 UI 禁用某选项当作安全校验。

新增渠道通常只需定义、adapter、注册和测试；新控件类型仍可能需要 UI 开发。不要承诺任意协议零改核心。

## 5. 配置与版本化快照

建议配置形状（示意，不是未经关联的最终类型）：

```ts
type GenerationSelection = {
  version: 2;
  providerId: string;
  modelId: string;
  options: ProviderOptions;
  background: 'original' | 'native-transparent' | 'magenta-key';
};
```

实现中必须用按 provider 区分的联合类型或等效类型绑定 provider/model/options；`ProviderOptions` 不是任意 `Record<string, any>`。输入接收 unknown，经注册定义解析后才能调用 adapter。

- 拒绝未知专属字段、错误类型、非法模型和冲突组合，不能原样 spread 用户 options 到上游请求。
- prompt/有序参考图继续用既有快照；count 属于 job，不进入单次 adapter 的批量生成参数。每次固定一张图。
- 配置中只存渠道标识、模型、已归一化参数和背景策略；不存 key、endpoint、headers、SDK 原始对象。
- 建任务时固定应用默认值。auto/省略只表示委托上游选择；读取旧任务时不能重新注入后来改过的应用默认值。
- 选择的渠道必须持久化。新增其他环境变量或重启不能改变 v2 任务的渠道；修改该渠道 endpoint 则影响其后续执行，文档明确这一运行配置边界。

背景策略：Gemini 默认 magenta-key；OpenAI 默认 native-transparent；关闭时 original。OpenAI 的 original 在 adapter 中明确映射 opaque，不做本地处理。OpenRouter 按模型能力决定允许的策略，不能默认所有模型都原生透明。能力不支持则拒绝，不偷偷换模型或抠底。

采用嵌套 options 是一次有意的跨端迁移：避免未来每个参数都加入全局联合字段和 worker 透传列表。HTTP、CLI、持久化、worker、Web 复用必须一起改，不能只实现动态表单。

## 6. 旧任务和旧调用兼容

1. **不批量改写旧快照**。无版本格式由 legacy decoder 处理，保留现有 Google/Gateway 环境选择语义。旧任务没记录渠道，不能假造“当时实际使用的渠道”。
2. 新任务必须落 v2 明确渠道。旧 HTTP/CLI 扁平参数由边界兼容转换；未指定 provider 时沿用旧选择优先级，再把解析结果固化。新旧配置混用且冲突时拒绝。
3. 前端不读环境配置。旧任务复用需要的 legacy 渠道选择由服务端返回安全的解析结果或默认渠道 ID，并标记这是按当前配置解析，而非历史事实。
4. 历史复用先解码再生成草稿。未知版本、删除的渠道或下线模型保留信息并显示无法复用/执行，不静默回退默认模型。
5. 重试沿用任务渠道和选项；换渠道属于新建任务。旧 preview 不能无提示变正式版。
6. 新任务的模型输入限制在引用解析后、createJob 前统一校验；历史超限任务执行时复用同一规则，不能截断参考图或在 worker 复制第二套校验。
7. legacy 解码与 v2 校验职责分开，不能为了兼容旧字段弱化 v2 的未知字段拒绝策略。

## 7. 输入框下的交互

```text
[提示词输入框                                  ]
[API 渠道 ▼] [模型 ▼]
[当前渠道/模型的常用选项……]
[生成张数] [背景选项与处理说明] [更多参数] [生成]
```

- Google：比例、1K/2K/4K、移除背景（洋红抠底）。
- OpenAI：像素尺寸、质量、透明背景（原生）。
- OpenRouter：只展示该模型/指定上游支持的比例、尺寸、质量和背景。

仅显示当前渠道，不将所有表单平铺。字段描述按基础/高级分组，`ProviderOptionsFields` 用现有 shadcn 控件渲染；它不是校验中心。

切换渠道时保留 prompt、引用和 count，原子重建模型和专属 options，默认不跨渠道搬运同名参数。切模型时在当前渠道内原子收敛选项。清空显式参数需提示；首版不增加跨渠道草稿持久化。

相关 UI 接缝：

- [main.tsx:339](../../web/src/main.tsx#L339)：现有模型/比例/档位工具栏。
- [main.tsx:627](../../web/src/main.tsx#L627)：参数弹窗有本地副本，避免切渠道后旧弹窗写回过期配置。
- [main.tsx:198](../../web/src/main.tsx#L198)：复用覆盖比较需由顶层浅比较改为规范化结构比较。
- [web/api.ts:32](../../web/src/api.ts#L32)：历史快照还原与默认值逻辑需要双格式解码。

建议安全配置状态接口 `/api/image-providers`：仅返回渠道 ID、本地配置状态、固定原因码，以及旧格式所需的默认解析渠道；不返回 URL、key、原始异常。状态只能表示本地配置齐备，不冒充网络/账户可用性探测。未配置渠道可查看选项但不能提交，提示所需环境变量名；服务端仍独立检查。

## 8. CLI 与 HTTP 对等能力

建议语法：`--provider`、`--model`、可重复 `--option name=value`。旧比例/档位/背景 flags 保留为兼容别名。此语法是推荐实现细节，不是架构硬约束；若调整，仍须保证所有 UI 参数均可通过 CLI 表达。

- 布尔只接受明确 true/false；数字必须严格解析且有限，遵守整数/范围限制。
- 重复 key、别名与通用 option 冲突、未知 key 均报用法错误；不猜测类型，不静默覆盖。
- [cli-spec.ts](../../src/cli-spec.ts) 继续描述命令/flag 语法，渠道定义描述模型选项。help/json 暴露可发现的渠道、模型和选项，不需要每个专属参数都增加全局 flag。
- [cli-run.ts:172](../../src/cli-run.ts#L172) 与 [server/api.ts:231](../../server/api.ts#L231) 汇入同一验证/归一化流程，createJob 前验证展开后的输入限制。
- 参数错误与配置错误保持区别；CLI 参数错误退出 2，配置/运行错误退出 1，既有部分生成失败契约不改变。HTTP 保持固定、脱敏错误响应，不把上游原文返回客户端。

## 9. 首批协议与外部证据

详细调查来源见 [历史双路线记录的调查来源](image-provider-directions-2026-09-12.md#调查来源)。以下是当日调查结果，实施前需复核：

| 渠道 | 首批策略 |
| --- | --- |
| Google 直连 | 保留现有 SDK、两个 Gemini 模型的映射与洋红算法 |
| AI Gateway | 保留现有通道/SDK；新任务固定为独立渠道，不再执行时根据其他 key 换路由 |
| OpenAI Images | `/images/generations` 与 multipart `/images/edits`，base64 PNG、原生透明；候选 SDK 为 @ai-sdk/openai 3.x 配合现有 AI SDK，版本需重新核对 |
| OpenRouter Images | 独立 `POST /api/v1/images` JSON、input_references data URL、base64 结果；不是改 OpenAI base URL 即可兼容 |

建议 OpenAI/OpenRouter 首批以 GPT Image 2.5 Flare/Sunburst 为主。GPT Image 2 是否纳入、首版精确尺寸范围是待实施前复核的小范围选择，不需要重新讨论路线三本身。

已知差异：OpenRouter 的 GPT Image 2 当日未列透明支持；2.5 列 transparent 与 xhigh/max；Gemini Pro 的 AI Studio 支持 4K，而 Vertex 仅列 1K/2K。不能以模型目录能力并集作为所有上游能力，不能把原厂尺寸范围无条件套到聚合端点。

OpenRouter 首版建议在 adapter 固定已核对上游并禁用不确定 fallback；无自动跨渠道 fallback。精确像素与元数据缺口需要复核，不能宣称文档/mock 等于实际 alpha/边缘/尺寸验收。

环境变量只记录名称，不记录值：现有 GEMINI_API_KEY/GEMINI_USER_AGENT/AI_GATEWAY_URL/AI_GATEWAY_TOKEN 保留相应渠道语义；新增 OPENAI_API_KEY/OPENAI_BASE_URL、OPENROUTER_API_KEY/OPENROUTER_BASE_URL。自定义 base URL 校验 HTTP(S) 根前缀，拒绝 userinfo/query/fragment，保留合法自定义路径，不自动补错误路径或跨域回退。

## 10. 非目标与 durable 边界

不做：热加载插件、远程执行配置、请求模板 DSL、任意 headers、自动协议探测、全量在线模型自动上架、mask 编辑器、视频、UI 凭证设置、多用户鉴权改造、队列并发重构。

**一次返回图片的 Promise 不足以覆盖所有异步任务 API。** 将来若接 submit/poll 协议并要求重启续查，需持久化远端 task ID、阶段与恢复信息，届时评估 schema；不能仅在 adapter 内存轮询后宣称 durable。首批四渠道先限定一次生成请求返回最终结果。

新 adapter 不内置隐式重试；保留既有 Google 重试行为时应明确记录，不顺手改变。worker 的 queued 取消、在途完成、心跳、stale 恢复和已有产物复用不变。超时不能证明远端没完成，也不解决“远端成功、本地登记前崩溃”的重复计费问题，不承诺 exactly-once。

保留 worker safeError，并在 adapter 边界避免真实 key、响应原文或 headers 泄漏。共享模块和客户端包不含凭证读取。

## 11. 分阶段实施与验收

### 阶段一：共享契约与迁移

完成 provider+model 关联类型、字段定义、静态注册、legacy/v2 decoder、默认值和背景策略。测试未知版本/渠道/字段、非法组合、auto/default，以及不会重新注入新默认值。

### 阶段二：现有渠道迁入

将 Google/Gateway 移入 adapter，保持原模型映射/背景算法。测试 legacy 仍遵守旧路由、v2 固定渠道、相同生成命令结果返回契约不变。

### 阶段三：跨端透传

更新 HTTP、CLI、snapshot、worker、help/json 与旧 flags 兼容。新专属 options 经验证后整体传递；添加后续选项无需再改 worker 字段清单。

### 阶段四：新增协议

接 OpenAI/OpenRouter，使用注入 env/fetch 的离线 mock。核对路径、认证、不泄密、JSON/multipart/data URL、参考图顺序、n=1、质量/尺寸/背景、空结果、损坏图片、错误状态与超时。原生透明不得经过洋红流程。

### 阶段五：Web 表单与复用

完成渠道/模型选择、有限动态字段、安全配置状态、双格式复用、结构比较、切换原子性、参数清理提示与弹窗旧值防护。使用现有组件，不重做整个页面。

### 阶段六：回归与当前文档

同步 agent-doc 的配置、架构、数据层、生成、CLI、Web 和 operations 文档；本文和双路线历史原文不改写为现状说明。

运行：

```sh
bun test
bun run typecheck
bun run build
bun run check
bun run cli -- help --json
```

按验证文档记录既有失败，不能先假定 check 失败，也不要手改 drizzle 生成快照。测试可用 Bun 的 `--no-env-file` 隔离凭证自动加载；临时日志/DB/输出统一放 `.temp/`。真 provider 必须被假实现替代。

验收清单：

- Web/CLI 等效输入得到等效快照；所有 UI 参数 CLI 都可表达。
- 同模型不同渠道能力互不污染，新参数不再修改 worker 透传字段清单。
- 非法输入先于建任务失败，配置错误不泄露密钥；不知道的选项不是静默丢弃。
- 旧任务不假造历史渠道、不自动换 preview；新任务不会因环境里其他 key 变化换渠道。
- 重试不跨渠道；未知/下线配置明确失败或不可复用，不静默改成默认模型。
- 原生透明和洋红处理互斥，图像字节/MIME 验证正确；不接受 SVG 进入现有栅格输出链路。
- 原有参考图顺序、状态迁移、取消竞态、心跳、恢复和产物复用回归通过。
- 前端构建不引入 SDK、node 模块或环境配置。

真实出图验收必须另行授权，并限定预算/样本。离线 mock 只能证明适配器协议与本地逻辑，不能证明账户可用性或图像质量。

## 12. 交接时状态

只有文档发生变更，业务实现尚未开始。此前归档 A/B 时测试为 93 pass / 0 fail，typecheck 通过；这是历史基线，不是路线三实现结果。本轮不安装依赖、不读取凭证、不生成图片、不提交代码。

新 session 可直接使用以下启动指令：

> 请阅读 AGENTS.md 与 agent-doc/design/image-provider-acl-2026-09-12.md，按已定案的路线三开始实施。先核对工作区和测试基线，遵循分阶段验收，不调用真实 provider，不自动 commit。
