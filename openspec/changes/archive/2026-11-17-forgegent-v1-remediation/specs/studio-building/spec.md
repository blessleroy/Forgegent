# studio-building Delta

## MODIFIED Requirements

### Requirement: 对话创建 Agent 草稿

Builder SHALL 通过自然语言对话创建 Agent 草稿：Builder Agent 的 LLM 后端 MUST 真实接入管理员配置的 OpenAI 兼容 chat 端点（端点与凭证来自模型资源配置；模型名解析顺序为 `FORGEGENT_BUILDER_MODEL` 环境变量优先、缺省用资源配置的模型名，D42）；无可用端点时 SHALL 回退到确定性启发式后端，且 Studio MUST 明示当前为「离线演示模式」（含草稿产物标注），启发式输出 MUST NOT 冒充 LLM 生成。Builder Agent 输出 MUST 包含结构化需求清单、待补信息与拟生成的应用组成；对关键缺项 MUST 进行少量定向提问（存在关键缺项时至少一轮）。

#### Scenario: 对话生成完整草稿（AT-01）

- **WHEN** Builder 以自然语言描述"创建一个可生成活动海报的 Agent，员工输入主题和风格"且模型端点可用
- **THEN** LLM 后端产出包含 Agent Prompt、Skill 草稿、UI Schema、Tool 绑定、资源引用、测试用例与使用说明的结构化草稿，字段经校验合法

#### Scenario: 离线演示模式明示

- **WHEN** 平台未配置可用模型端点，Builder 在 Studio 发起对话
- **THEN** 草稿由启发式后端生成且 Studio 明示「离线演示模式」，草稿记录该标注供审核者查看

### Requirement: 对话修改草稿并展示差异

Builder SHALL 能在同一对话中以任意自然语言提出修改（不限于预置关键词指令）；LLM 后端 MUST 将修改作用于当前草稿的结构化字段并展示差异（变更摘要）；修改 MUST NOT 影响任何已发布版本。

#### Scenario: 修改同步草稿与预览（AT-02）

- **WHEN** Builder 对已生成的海报 Agent 草稿说"增加参考图上传，输出比例改为 9:16，另外生成 Word 版说明"
- **THEN** 草稿的 UI Schema、工具绑定与说明同步结构化变更（非仅追加描述文本），差异在对话中可见，且已有发布版本不受影响

### Requirement: 员工视角预览与隔离测试

Builder SHALL 能在不运行任务的情况下预览员工视角的 UI Schema 渲染（与 Hub 任务页同一渲染器），也能以经授权测试资源执行隔离测试（`origin=test`，仅 Studio 可见，测试运行含脚本执行时必须在沙盒内）；Builder MUST 能查看报错并迭代。

#### Scenario: 预览运行可迭代

- **WHEN** Builder 在草稿页打开员工视角预览并发起一次隔离测试，测试因配置错误失败
- **THEN** Builder 看到失败的结构化原因与员工视角 UI 预览，修改草稿后可再次测试

#### Scenario: Schema 员工视角预览

- **WHEN** Builder 在草稿页切换到"员工视角预览"
- **THEN** 页面以生产同款渲染器展示该草稿 UI Schema（form-result 与 document-flow 皆可），无需运行任务

### Requirement: 提审、撤回与复制

Builder SHALL 能提交草稿审核、撤回未处理的申请、复制已有发布版本形成新草稿；Studio MUST 提供撤回入口（API 已有）；Admin 的审核拒绝理由 MUST 在 Studio 草稿详情中对 Builder 可见（拒绝后退回 editing 并保留理由）。

#### Scenario: 复制发布版本成新草稿

- **WHEN** Builder 选择一个已发布版本并复制为新草稿
- **THEN** 新草稿属于该 Builder（owner=复制者），版本号递增，原发布版本不变

#### Scenario: 撤回与拒绝理由可见

- **WHEN** Builder 提审后撤回；或 Admin 拒绝并附理由
- **THEN** 撤回后草稿回到 editing 可继续修改；拒绝理由在 Studio 草稿详情中向 Builder 展示

### Requirement: 提审自动测试闸门

提审时系统 SHALL 运行自动测试闸门：模型端点可用时 MUST 真实执行草稿声明的测试用例（以 `origin=test` 隔离运行），端点不可用时结果标注「未运行（离线演示模式）」；闸门失败 MUST NOT 阻断提交（仍可提交审核），结果 MUST 附给审核者（N5/D41）。

#### Scenario: 失败可提交但审核可见

- **WHEN** Builder 提交一个自动测试未通过的草稿
- **THEN** 提交成功进入 in_review，Admin 审核界面可见失败结果与原因

#### Scenario: 离线时闸门标注

- **WHEN** 无可用模型端点时 Builder 提审
- **THEN** 闸门结果记录为「未运行（离线演示模式）」并附给审核者，不阻断提交

### Requirement: Studio 访问角色门槛

无 Builder 角色的用户 MUST 在页面与 API 两层都被拒绝访问 Studio：API 由服务端角色守卫拒绝；页面 MUST 由服务端侧（中间件/服务端重定向）阻断渲染，MUST NOT 仅依赖前端隐藏导航（AT-17）。

#### Scenario: 页面与 API 双拒绝（AT-17）

- **WHEN** 仅具备 Employee 角色的用户直接访问 `/studio` 页面或调用 Studio API
- **THEN** 页面被服务端重定向/拒绝渲染，API 返回 403，且拒绝事件留痕

### Requirement: V1 生成物形态

V1 以既有 UI 模板 + Schema 生成为主（自定义 React 页面为 P1）；Builder Agent 生成物 MUST 完整覆盖：Agent Prompt、Skill 草稿（skillRefs）、UI Schema（form-result/document-flow）、Tool 绑定、资源引用（resourceRefs）、测试用例、使用说明（usage）与图标建议（icon）；`modelRef` MUST 引用真实配置的模型资源而非恒定占位值。

#### Scenario: Schema 驱动生成

- **WHEN** Builder Agent 为"方案生成专家"生成草稿
- **THEN** 产出 document-flow 模板 UI Schema、文档导出工具绑定、非空资源引用与使用说明，全部字段经草稿校验

## ADDED Requirements

### Requirement: LLM 生成物引用校验

草稿保存/更新时系统 MUST 对 LLM（或启发式）产出引用中**具有真实效力**的部分做全量校验：`skillRefs`（published + 该 Builder 绑定授权）、`toolRefs` 中 `http.*`（必须已由管理员声明）、`resourceRefs`（必须存在为资源名）；任一校验失败 MUST 拒绝保存并向 Builder 报错（附可用授权列表），LLM 后端在失败反馈下重试一次，仍失败则将错误返回 Builder（D37；生成型 Skill 草稿除外——它随 Agent 走连带审核，见 skill-registry）。`toolRefs` 其余 ID 与 `modelRef` 属 PRD §6「能力引用」（无执行器即无能力），保存时仅格式校验，未解析的 `modelRef` 由提审闸门与执行时回退（默认端点）承接。

#### Scenario: 无权 Skill 引用被拒并提示

- **WHEN** LLM 生成物引用了该 Builder 无绑定授权的已发布 Skill
- **THEN** 草稿保存被拒绝，错误附该 Builder 可绑定的 Skill 列表；LLM 据此重试仍失败时 Builder 收到明确错误而非静默剔除
