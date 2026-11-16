# Forgegent（智体工坊）— 企业级 Agent 应用构建与发布平台 PRD

> **产品名称**：Forgegent（智体工坊）  
> **项目标语**：Build Agents. Ship Applications.  
> **建议 GitHub 仓库名**：`forgegent`  
> **版本**：V1.0（AI 开发实施版）  
> **状态**：需求基线 / 待开发  
> **目标交付**：可自行部署、具备开放源码发布条件的单企业实例 Web 产品  
> **核心内核**：`pi-coding-agent SDK`  
> **文档性质**：面向 Coding Agent 的可执行产品需求，包含范围、交互、数据、约束、验收和实现顺序；技术细节属于建议实现，除明确“必须”项外可在不破坏验收标准的前提下调整。

---

## 0. 给开发 AI 的执行约定

1. **以本 PRD 为实现基线**。先生成技术设计、任务拆解和测试矩阵，再逐项实现；不得用“已能聊天”代替“已能生产并发布 Agent 应用”。
2. **不得擅自增加基础设施**：V1 不引入 Redis、消息队列、S3/MinIO、Keycloak、Kubernetes、复杂微服务和 SaaS 多租户控制平面。
3. **不可把平台做成聊天软件或工作流编辑器**：员工先选择已发布 Agent，再进入专属任务 UI；Builder 的构建过程可以使用对话。
4. **安全边界必须在服务端和执行端落实**，不能只靠 Prompt、前端隐藏按钮或数据库中写入角色名称。
5. **对外部依赖先锁定版本并核实 API**，尤其是 Pi SDK 的包名、Session/ResourceLoader 和工具接口；不根据旧教程臆造代码。
6. 代码变更要求附带对应单元/集成/E2E 测试；未通过测试的功能不能标记“完成”。不在未获授权的情况下接入真实企业密钥或数据。
7. 优先形成可运行的纵向闭环；P0 全部通过后再开发 P1。遇到需求空白时采用本文“默认决策”，写入 `docs/decisions.md`，不得反向扩大产品范围。

**优先级定义**：P0 = 首个可用版本必须；P1 = V1 稳定后增强；P2 = 长期扩展。  
**规范用语**：必须 = 强制验收；应当 = 默认实现；可 = 非强制。

## 1. 产品定义与边界

### 1.1 定位

Forgegent（智体工坊）是一个**通过自然语言构建、审核、发布和运行专业 Agent 应用**的开源友好型企业平台。它包含：

- **Forgegent Studio**：授权定制人员通过与 Builder Agent 对话，生成/修改 Agent 定义、Skills、工具绑定、专属 Web UI、资源配置与测试用例。
- **Forgegent Hub**：普通员工浏览已授权应用、以专属任务 UI 使用 Agent、查看进度及交付物。
- **Control Plane**：管理员维护用户角色、发布版本、Skill 审核、数据连接、模型配置、审计和执行策略。
- **Agent Runtime**：基于 `pi-coding-agent SDK` 实现自主推理、Skill/Tool 调用、会话管理，必要时进入隔离沙盒。

**一句话产品契约**：由少数有权限的人“用 Agent 制造应用”，由多数普通员工“像使用 Web 软件一样使用已发布应用”。

### 1.2 产品原则

1. **集中构建、集中发布、按权使用**，不赋予普通员工创建或修改生产 Agent 的权限。
2. **Agent-first / Skill-first**：模型按任务动态规划和调用能力；可以有固定业务表单、必要人工审批和约束，但不以节点拖拽工作流为核心。
3. **Agent 是应用而非 Prompt**：包含配置、UI、Skills、Tools、资源、权限、评测和版本。
4. **安全能力下沉执行层**：用户、Agent、任务三种权限取交集；每次敏感 Tool/文件/资源请求都校验。
5. **开源优先、单企业一套实例**：V1 每个企业独立部署，无跨企业共享数据或 SaaS 租户管理。
6. **简单可部署**：无需排队系统或对象存储，单机 Docker Compose 可用。

### 1.3 V1 非目标

- 不做 WorkBuddy 式“所有员工都可建 Agent”；不做通用 ChatGPT 聊天首页。
- 不做 Dify/Coze 式可视化节点工作流编辑器。
- 不做在线多人协同 IDE、完全自动发布任意生成代码、云端 Agent 市场。
- 不做完整 Office 桌面级编辑器；PPT/Word 以预览、必要修订、导出为主。
- 不承诺进程崩溃后“从任意工具调用中间指令精确恢复”；可恢复已持久化上下文与文件，任务可重试。
- 不在 V1 内置所有外部连接器；先用经管理员配置的本地文件/HTTP API 连接方式。

## 2. 用户角色与授权模型

| 角色 | 创建/编辑草稿 | Builder 测试 | 提交审核 | 审核/正式发布 | 使用已发布 Agent | 投稿 Skill | 系统管理 |
|---|---|---|---|---|---|---|---|
| 平台管理员 Admin | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| Agent 定制人员 Builder | 是（有权范围） | 是（仅隔离测试资源） | 是 | 否 | 是 | 是 | 否 |
| 普通员工 Employee | 否 | 否 | 否 | 否 | 是（授权范围） | 是 | 否 |

- 角色可按人分配，一个人可以拥有多个角色，后端以最小授权原则计算权限；`Builder` 不继承 `Admin`。
- `Employee` 即使直接调用 API、修改前端请求，也不能创建/更改/发布 Agent、安装生产 Skill 或获得额外 Tool。
- 发布对象默认指定 `全体员工` 或具体成员/部门（V1 部门可以由管理员手动管理，不依赖外部组织目录）。
- Agent 对企业资源的授权不能自动扩大员工本人对该资源的访问权限。

## 3. 典型用户旅程

### 3.1 构建“海报设计师”

1. Builder 进入 Studio，输入：“创建一个可生成活动/早安海报的 Agent；员工只输入主题和风格，固定使用我配置的生图模型，并自动应用公司 Logo。”
2. Builder Agent 提炼目标、输入字段、输出格式、资源与风险；对关键缺项进行少量定向提问。
3. 自动生成 Agent 草稿、系统约束、相关 Skills、可调用工具配置、表单/预览 UI、测试用例。
4. Builder 绑定允许使用的文生图与图生图服务，上传经授权的品牌素材，检查费用/网络范围。
5. 在隔离预览环境运行“首次生成—修改文案—重新导出”，查看 UI 与成果。
6. Builder 提交审核；管理员确认发布配置、模型、权限、脚本/组件安全后发布。
7. 员工打开 Hub 里的“海报设计师”，输入需求，获得预览和图片；员工没有更换模型、安装 Skill、执行 Shell 的入口或权限。

### 3.2 构建“方案生成专家”

1. Builder 对话定义应用，指定内部历史方案作为参考资料、输出 DOCX、分阶段确认大纲。
2. Builder 通过资源授权向导导入/绑定历史方案文件或受控检索接口，设定用户可见范围。
3. Builder Agent 生成资料上传、大纲预览、生成进度、文件下载页面，并创建检索与文档生成 Skills。
4. 员工上传客户需求后，Agent 只能检索该员工对历史方案库拥有访问权的内容，生成方案并输出 Word。
5. 员工继续提修改要求，恢复同一工作会话，不必重复创建 Agent。

### 3.3 Skill 投稿

员工提交 Skill 说明或 ZIP → 平台标记待审核 → 管理员安全检查/测试 → 发布 Skill 版本 → Builder 在新 Agent 草稿中选择绑定 → 正式发布后员工方可使用。投稿不等于即时安装、运行或授权。

## 4. 信息架构与页面范围

| 入口/页面 | P级 | 功能 |
|---|---|---|
| `/login` | P0 | 登录/退出、会话管理 |
| `/hub` | P0 | Agent 应用卡片、分类、搜索、授权过滤 |
| `/apps/:slug` | P0 | Agent 专属任务页（由 UI Schema 渲染） |
| `/tasks`、`/tasks/:id` | P0 | 个人任务列表、状态、事件、继续修改/取消 |
| `/files` | P0 | 我的文件、上传、下载、删除、任务成果关联 |
| `/studio`、`/studio/:draftId` | P0 | Builder 对话、草稿版本、资源绑定、UI 预览、测试、提交审核 |
| `/admin/agents` | P0 | 审核、发布、上下架、授权、版本回滚 |
| `/admin/skills` | P0 | Skill 投稿审核、发布、版本管理 |
| `/admin/resources` | P0 | 模型/工具/企业资料资源配置、授权策略 |
| `/admin/users` | P0 | 用户、角色、部门/成员授权 |
| `/admin/audit` | P0 | 权限拒绝、发布、敏感操作、运行失败日志 |
| `/requests` | P1 | 员工提交 Agent 需求与状态追踪 |
| `/admin/usage` | P1 | 成功率、Token、模型和工具成本趋势 |

UI 原则：员工进入 Hub 看的是**应用清单**，不是空白聊天框。不同 Agent 可使用不同 UI 模板，聊天只是局部“继续修改”的交互方式之一。

## 5. 功能需求（可验收）

### 5.1 FR-01 Forgegent Studio（P0）

- FR-01.1 Builder 能通过自然语言创建 Agent 草稿；Builder Agent 输出结构化需求清单、待补信息和拟生成的应用组成。
- FR-01.2 Builder 可在同一对话中提出“增加上传附件”“改为 9:16”“生成 Word”等修改；修改应作用于当前草稿，并展示差异。
- FR-01.3 Builder Agent 能生成/调整：Agent Prompt、Skill 草稿、UI Schema、Tool 绑定声明、资源引用、测试用例和简要使用说明。
- FR-01.4 Builder 生成的是**草稿**，不会获得生产系统权限，也不能自行发布。
- FR-01.5 Builder 可预览最终员工视角，使用模拟或经授权的测试资源执行任务；必须可查看报错并迭代。
- FR-01.6 Builder 可提交审核、撤回未处理的申请、复制已有发布版本形成新草稿。
- FR-01.7 V1 以**既有 UI 模板 + Schema 生成**为主；复杂自定义 React 页面生成列为 P1（仍由 Builder 对话触发，须有独立安全审核和构建）。

### 5.2 FR-02 Agent 应用包与发布（P0）

- FR-02.1 Agent 应用必须有唯一 ID、名称、描述、图标、归属、版本、模型配置、Skill/Tool 引用、UI Schema、资源授权声明、发布范围。
- FR-02.2 发布产物为**不可变版本快照**，Task 创建时绑定版本；新发布不能改变进行中的旧任务。
- FR-02.3 管理员审核通过后方可发布；支持下架、指定版本回滚（通过切换活跃版本指针实现）。
- FR-02.4 应用包可导出/导入，但必须去除密钥、私有资源内容和组织内部身份引用；导入时需要重新授权模型、工具、资源。
- FR-02.5 所有运行时只接受已发布的 Agent 版本，或隔离的 Builder 测试版本；不可执行来自员工请求的任意应用定义。

### 5.3 FR-03 员工 Forgegent Hub（P0）

- FR-03.1 员工仅看到被授权 Agent；可以搜索、查看介绍与使用提示。
- FR-03.2 点击 Agent 进入其定义的任务页面，展示输入字段、文件上传、参数、执行按钮、状态、成果和必要的修改入口。
- FR-03.3 员工不能修改模型提供商、系统 Prompt、Skills、Tools、数据源或执行策略。
- FR-03.4 员工可在自己已有 Task 上继续修改，保持任务关联的上下文和文件。
- FR-03.5 结果文件可下载、预览（支持时）、在个人文件空间查找。

### 5.4 FR-04 Skill Registry（P0）

- FR-04.1 Skill 由 `SKILL.md`、可选脚本/素材/引用文件组成；存储版本及内容哈希。
- FR-04.2 员工可投稿描述或压缩包，状态为待审核；**任何未审核 Skill 不得进入生产 ResourceLoader**。
- FR-04.3 管理员可审核、拒绝、发布、撤销；需要保留审核人与结论。
- FR-04.4 Builder 只能从自己获授权的 Skill 列表绑定到草稿；发布后锁定具体版本和校验值。
- FR-04.5 允许无脚本的指令型 Skill 在受限工具 Agent 中使用；包含脚本/依赖/扩展的 Skill 必须走沙盒并执行更严格检查。

### 5.5 FR-05 企业资源连接（P0 基础，P1 扩展）

- FR-05.1 V1 提供：个人文件、企业公共只读资料、经管理员配置的受控 HTTP API 工具；P1 可增加专用知识库检索/连接器。
- FR-05.2 不允许 Builder 或运行 Agent 任意创建具有生产凭证的连接器；资源接入由管理员审批并绑定到 Agent 发布版本。
- FR-05.3 资源内容必须带访问范围；检索服务**先做权限过滤，再给模型返回内容**。
- FR-05.4 资源中的文字属于不可信数据，不能把“历史方案内容中的指令”提升为系统指令或 Tool 授权。
- FR-05.5 企业共享资源默认只读。修改、删除、外发等操作必须显式授权；高风险操作可要求本人确认，但不能借确认提升原始权限。

### 5.6 FR-06 任务、会话和成果（P0）

- FR-06.1 创建任务时记录 `owner_id`、`agent_release_id`、输入摘要、文件引用、资源授权上下文、状态、预算和执行模式。
- FR-06.2 任务状态包含：`pending`、`starting`、`running`、`waiting_input`、`completed`、`failed`、`cancelled`、`interrupted`。
- FR-06.3 Web 关闭不终止正在执行的任务；员工可重新打开查看进度和成果。
- FR-06.4 支持用户取消；取消后阻止新工具操作，并尽力中止当前可中断操作。
- FR-06.5 通过 SSE 推送过滤后的进度/工具状态/成果，不暴露模型私有推理原文、环境变量、凭证和敏感路径。
- FR-06.6 Session 和任务成果持久化。Runner 崩溃后将未完成任务标记为 `interrupted`，允许安全重试/继续；不得宣称任意指令级自动恢复。
- FR-06.7 V1 单进程 Runner 使用 SQLite 待执行任务表、并发上限和租约防重，**不需要 Redis 或 MQ**。
- FR-06.8 外部生成操作使用任务级幂等键、结果校验和必要的人工重试提示，避免重试重复扣费或覆盖结果。

### 5.7 FR-07 个人文件空间（P0）

- FR-07.1 每名员工有独立、持久化的文件列表：个人上传文件、成果、版本和与任务的关联。
- FR-07.2 V1 使用本机目录 + SQLite 元数据，不使用 S3；文件读取、下载、删除都必须检查服务端资源 ACL。
- FR-07.3 任务沙盒只能拿到本次已授权文件的副本或受控挂载，不能挂载整个用户目录；任务结束将指定成果写回个人空间。
- FR-07.4 防止路径穿越、符号链接逃逸、任意绝对路径访问以及通过可猜测 ID 获取他人文件。
- FR-07.5 文件下载采用受保护的服务端接口，禁止直接把内部数据目录暴露为 Web 静态目录。
- FR-07.6 配置文件大小、类型、单用户配额与保留策略；V1 默认示例：单文件 ≤ 50 MB、每用户 ≤ 2 GB，均由管理员调整。
- FR-07.7 提供数据库与文件系统的备份/恢复说明，要求备份时能获得一致性数据快照。

### 5.8 FR-08 受限与沙盒两种运行模式（P0）

**受限工具模式 `restricted`**：仅加载平台可信、已审核的调用型 Tools；禁用 Shell、任意代码、自由文件系统访问和未授权 Extension。适用于主要调用生图 API 等已封装工具的 Agent。Agent 可在常驻 Runner 中执行，Session 隔离、工具端检查仍必须存在。

**沙盒模式 `sandboxed`**：Builder Agent、含动态代码执行/依赖安装/第三方脚本的业务 Agent 必须使用独立沙盒；在沙盒内执行 Pi 和相关脚本（不是宿主机运行不可信 Extension）。V1 可用 Docker Rootless，每工作会话一个容器，首轮按需启动、多轮复用、空闲 15 分钟回收；回收前持久化必要数据。镜像提前构建，严禁挂载 Docker Socket、生产密钥或整个用户目录。

- FR-08.1 沙盒默认非特权、最小 capabilities、seccomp、资源上限、限制出网；Rootless 不是强隔离的充分条件。
- FR-08.2 不可信脚本、生成前端代码的构建/测试必须在沙盒，且不能获得宿主机/管理 API 的宽泛访问权。
- FR-08.3 执行环境可通过接口替换为 gVisor/MicroVM；V1 不实现容器预热池，除非性能测试明确需要。
- FR-08.4 退出、空闲回收、用户取消、进程崩溃必须清理临时文件与容器；保留审计与持久成果。

### 5.9 FR-09 Agent 级权限（P0）

有效权限 = **当前用户授权 ∩ Agent 发布版本授权 ∩ 当前任务授权**，且所有未列入白名单的操作默认拒绝。

- FR-09.1 用户无 Agent 使用权限时，Hub 不展示、API 也拒绝创建任务。
- FR-09.2 Agent 只能使用发布版本指定的模型、Skills、Tools、资源和网络目标；用户提示词不能增加这些能力。
- FR-09.3 每次 Tool 调用由可信服务端 Gateway 校验用户/Agent/Task/动作/资源/参数，不仅在 Prompt 或 Tool 描述中限制。
- FR-09.4 `restricted` 模式不能调用 `bash`、任意 Python/JS 执行或任意文件读写；不能加载未审核 Extensions。
- FR-09.5 文件访问、企业历史方案检索、下载和写入都检查用户 ACL。Agent 连接了某数据库不代表用户拥有全部数据访问权。
- FR-09.6 未经审批的 Builder 草稿不得提权、直连生产密钥、对外发送企业数据或安装生产 Tool。
- FR-09.7 拒绝事件记录到审计日志，包含时间、用户、Agent、动作、资源标识和原因，不记录秘密值。
- FR-09.8 Agent 的业务职责（如只做海报）通过 UI Schema、任务类型、系统指令和结构化输出校验共同约束；不得声称仅靠 Prompt 能百分百避免回答偏题。

### 5.10 FR-10 账号与基础配置（P0）

- 用户登录/退出、会话过期、管理员邀请/创建用户、重置密码；推荐在 Next.js 内集成 Better Auth 或同类轻量方案。
- 密码必须安全哈希，Session Cookie 应启用 `HttpOnly`、`Secure`（HTTPS）、`SameSite`；敏感 API 防 CSRF、限流和暴力尝试。
- 模型 API Key 只存放于服务端受保护配置/秘密存储，不返回浏览器、不直接注入不可信沙盒；沙盒通过受控代理或短期凭证调用模型。
- V1 不引入独立 Keycloak，未来可扩展 OIDC/企业微信身份集成。

## 6. Agent App Package 规范（V1）

建议用清晰的配置清单和单独资源目录，支持从 Builder 输出、管理员审阅、导出/导入。示例：

```text
agent-app/
  manifest.json          # 基本信息与运行授权
  prompts/system.md      # Agent 职责、限制与输出要求
  ui/schema.json         # 员工专属 UI，V1 采用受控 Schema
  skills/poster-design/  # SKILL.md、引用资料及经审核脚本
  tests/cases.json       # 验收用例
  assets/                # 非机密公共模板/图标
```

`manifest.json` 示例（仅示意字段，实际以 JSON Schema 校验）：

```json
{
  "schemaVersion": "1.0",
  "id": "poster-designer",
  "name": "海报设计师",
  "version": "1.0.0",
  "ui": { "type": "form-result", "schemaFile": "ui/schema.json" },
  "runtime": { "engine": "pi-coding-agent", "mode": "restricted" },
  "modelRef": "model-approved-001",
  "skillRefs": [{ "id": "poster-design", "version": "1.0.0", "sha256": "<approved-hash>" }],
  "toolRefs": ["image.generate", "poster.render", "artifact.save"],
  "resourceRefs": ["brand-assets-readonly"],
  "permissionPolicyRef": "poster-policy-v1",
  "inputSchema": "ui/schema.json",
  "tests": "tests/cases.json"
}
```

- 清单中的 `modelRef`/`resourceRefs` 是**能力引用**，不是密钥或真实组织内部路径。
- 发布时服务器将应用包、工具声明和关联 Skill 版本生成**只读、不可变快照**；执行时只加载该快照。
- 导入应用后状态为草稿，必须重新关联本企业模型/资源并重新审核；不可直接进入生产。
- **Schema 驱动 UI 是 V1 标准能力**；Builder 生成自定义 React/JS 应用属于 P1：在沙盒构建、审核依赖、限制浏览器权限，受控部署并与主站隔离。

## 7. 技术架构（轻量单体 + 独立 Runner）

```text
Browser
  ├─ Forgegent Studio (对话构建 / 预览 / 测试)
  └─ Forgegent Hub (应用中心 / 专属 UI / 任务与文件)
               │ HTTPS + SSE
               ▼
Next.js (Web + API + Auth + Permission Manager)
  ├─ Agent/Skill Registry & 发布管理
  ├─ User/Resource ACL & Tool Gateway
  ├─ Task Manager & Artifact/File API
  └─ SQLite (Drizzle) + Local Workspace
               │ 受控任务 API / 进度事件
               ▼
Node.js Agent Runner (独立常驻进程)
  ├─ 轮询 SQLite 待执行任务 / 限流 / 租约
  ├─ pi-coding-agent SDK / Session Adapter
  ├─ restricted: 白名单工具，无任意代码执行
  └─ sandboxed: 按会话启动 Docker Rootless 容器
               │
               ▼
经授权 Tool / 企业资源 / 模型 API / 文件成果
```

**建议选型**：Next.js + React + Tailwind/shadcn/ui、Node.js/TypeScript、`pi-coding-agent SDK`、SQLite + Drizzle、本地持久化目录、Better Auth（或同级轻量认证）、Docker Rootless、SSE。

**明确不需要**：NestJS、Redis、RabbitMQ/BullMQ、S3、Keycloak、Kubernetes、向量数据库和独立工作流引擎。未来当实际遇到多机、高可用、海量文件和复杂知识检索需求时再加扩展适配器。

V1 运行方式：一个 Web 进程、一个 Runner 进程、一个本地数据卷以及按需沙盒容器；单企业实例独立部署。无需要求每个用户永久占有一个容器。

## 8. 运行流程与异常处理

### 8.1 发布流程

`构建草稿 → 自动测试 → Builder 预览 → 提交审核 → Admin 审核 → 发布不可变 Release → 员工可见`

- 审核拒绝退回草稿，保留理由；发布后的修改必须创建新草稿。
- 下架阻止新任务创建；运行中任务按管理员明确的终止策略处理，默认允许安全完成。
- 回滚只改变新任务使用的 Release；历史成果与任务仍指向原 Release。

### 8.2 任务执行流程

1. API 校验用户对 Agent 的使用权及本次上传/资源访问权。
2. 在 SQLite 写入 Task + release 快照引用；状态 `pending`。
3. Runner 获取任务租约，决定 `restricted` 或 `sandboxed`；创建独立 Session、任务 Workspace。
4. 读取已发布 Skills/Tools/资源；执行期间 Tool Gateway 对每一次调用进行授权校验。
5. 前端通过 SSE 接收任务进度和经过脱敏的工具事件。
6. 产物先写入本次任务临时目录，校验后由服务端转存到员工持久化文件空间。
7. 写入任务最终状态、会话索引、计费记录和审计事件；沙盒按会话空闲策略回收。

### 8.3 重试、并发与恢复默认值

- V1 Runner 单实例；默认允许同时执行 5 个任务，可配置；对同一工作会话加独占锁，禁止两个请求同时修改一个 Pi Session。
- Runner 每隔短周期检查任务表；采用租约与 `lease_until` 处理异常重启，防止重复领取。
- 已执行但结果未知的外部操作不得盲目自动重试；先查询幂等记录，必要时标记人工重试。
- Session 和已生成文件可恢复；恢复新沙盒时只回填授权文件与会话状态。
- 任务事件持久化并提供按事件 ID 补读；刷新 Web 页面不丢失已记录的执行状态。

## 9. 数据模型（最小表集）

| 表 | 主要字段（关键字段示意） |
|---|---|
| `users` | `id`, `email/username`, `status`, `created_at` |
| `roles`, `user_roles` | `role`, `user_id`, `role_id` |
| `agents` | `id`, `slug`, `name`, `owner_id`, `active_release_id` |
| `agent_drafts` | `id`, `agent_id`, `builder_id`, `draft_payload`, `status` |
| `agent_releases` | `id`, `agent_id`, `version`, `immutable_package_path`, `checksum`, `published_by` |
| `agent_grants` | `agent_id`, `subject_type`, `subject_id`, `can_use` |
| `skills`, `skill_versions` | `id`, `version`, `package_path`, `checksum`, `status` |
| `skill_submissions` | `id`, `submitter_id`, `content_path`, `review_state`, `reviewer_id` |
| `resources`, `resource_grants` | `id`, `kind`, `config_ref`, `subject`, `actions` |
| `tasks` | `id`, `owner_id`, `agent_release_id`, `state`, `lease_until`, `session_id`, `mode` |
| `task_events` | `id`, `task_id`, `event_type`, `safe_payload`, `created_at` |
| `files` | `id`, `owner_id`, `task_id`, `storage_key`, `size`, `mime`, `checksum` |
| `session_refs` | `id`, `task_id`, `session_path`, `updated_at` |
| `tool_policies` | `id`, `release_id`, `tool_id`, `resource_scope`, `allowed_actions` |
| `audit_logs` | `id`, `actor_id`, `action`, `resource_id`, `decision`, `created_at` |
| `usage_records` | `task_id`, `model`, `input_tokens`, `output_tokens`, `estimated_cost` |

所有 API 查询必须在服务端按所有者、角色、部门与资源授权过滤；数据库关系本身不代替文件系统隔离。敏感配置不以明文存入应用包。

## 10. 最小 API 契约（建议）

| 方法和路径 | 作用 | 权限 |
|---|---|---|
| `GET /api/agents` | 列出当前用户可用的已发布 Agent | 登录用户 |
| `GET /api/agents/:id` | 查询应用详情/UI Schema | 已授权用户 |
| `POST /api/studio/drafts` | 从对话创建 Agent 草稿 | Builder |
| `POST /api/studio/drafts/:id/messages` | 通过 Builder Agent 修改草稿 | Builder/拥有者 |
| `POST /api/studio/drafts/:id/test` | 隔离环境测试 | Builder/拥有者 |
| `POST /api/studio/drafts/:id/submit` | 提交审核 | Builder |
| `POST /api/admin/releases/:id/approve` | 审核并发布 | Admin |
| `POST /api/tasks` | 以已发布版本创建任务 | 有使用权的员工 |
| `GET /api/tasks/:id` | 查看任务 | 所有者/明确授权者 |
| `GET /api/tasks/:id/events` | SSE 进度流/历史补读 | 所有者/明确授权者 |
| `POST /api/tasks/:id/continue` | 同一会话继续修改 | 所有者 |
| `POST /api/tasks/:id/cancel` | 取消任务 | 所有者/Admin |
| `POST /api/files` | 上传个人资料 | 登录用户 |
| `GET /api/files/:id/download` | 下载授权文件 | 文件授权者 |
| `POST /api/skills/submissions` | 员工投稿 Skill | 登录用户 |
| `POST /api/admin/skills/:id/review` | 审核并发布 Skill | Admin |

所有写接口必须进行输入 Schema 校验和服务端授权；SSE 断线重连不应造成任务重复执行。API 版本建议以 `/api/v1` 实际落地，可保持上表为概念路径。

## 11. 质量、安全与非功能要求

### 11.1 安全必须项

- **最小权限**：用户 ∩ Agent ∩ Task；默认拒绝未声明的模型/工具/资源/操作。
- **代码执行隔离**：所有不可信生成代码与脚本在沙盒运行；禁止特权容器、宿主 Docker Socket、敏感宿主路径挂载。
- **凭证隔离**：生产 API Key 不下发至浏览器和沙盒文件系统；敏感 Tool 使用服务端代理与范围受控凭证。
- **网络隔离**：沙盒默认无法访问管理 API、数据库、本机元数据接口和企业内部敏感网段；仅开放必要出网目标。
- **文件隔离**：不能通过路径穿越、符号链接、直接 URL 或任意文件 ID 读取他人资料。
- **资源越权保护**：检索前过滤，服务端执行时校验；提示词注入不能授予新权限。
- **版本不可变**：运行中的任务持有自己的 Agent/Skill 版本，不因管理员发布而改变。
- **审计可追溯**：发布、审核、拒绝、越权尝试、敏感工具动作留痕。

### 11.2 性能与可用性目标（V1 验收基线，需按部署机器实测）

- 目标在常见单机服务器上支持 **5 个并发运行任务**，用户任务/会话/文件严格隔离；并发上限可配置。
- Hub 常规页面在无大文件加载时应有可接受的交互速度；核心接口性能记录 P50/P95，避免将 LLM 等待误记为 Web 慢。
- 沙盒预装镜像，无每任务拉镜像；同一会话的连续修改复用沙盒。
- 每个任务设置最大时长、Token/费用预算和文件容量；超限时安全终止并说明原因。
- 出现 Runner 重启时系统可继续使用，未完成任务状态明确且支持恢复上下文/重试。

### 11.3 可观测性

- 最少记录：`request_id`、`task_id`、`agent_release_id`、阶段耗时、模型 Token、Tool 调用次数、错误类型、拒绝操作数。
- 管理员可按任务查询事件、输入输出文件和费用估算；日志必须脱敏。
- V1 用结构化 JSON 日志 + SQLite 审计表即可；OpenTelemetry/Grafana 为 P1。

## 12. 验收用例（AI 开发不得跳过）

| ID | 优先级 | Given / When / Then（通过标准） |
|---|---|---|
| AT-01 | P0 | Builder 通过对话创建海报 Agent → 生成可验证的应用草稿、Skill、UI Schema、测试用例 |
| AT-02 | P0 | Builder 修改“增加参考图上传” → 草稿与预览 UI 同步变更，不影响已有发布版本 |
| AT-03 | P0 | 未经管理员审核的草稿 → 员工 Hub 不可见，无法通过 API 运行 |
| AT-04 | P0 | Admin 发布海报 Agent → 授权员工可见并可生成、预览和下载图片 |
| AT-05 | P0 | 员工要求海报 Agent 执行 Shell / 查询财务资料 → 服务端 Tool/资源访问被拒并留痕 |
| AT-06 | P0 | 员工伪造 API 调用更改模型/Skill/Tool → 403 或相应拒绝，生产配置不变 |
| AT-07 | P0 | A、B 同时使用同一 Agent → 会话、临时文件和成果相互隔离 |
| AT-08 | P0 | A 猜测 B 的文件 ID/URL 或构造 `../`/符号链接 → 不可读取/覆盖 B 文件 |
| AT-09 | P0 | Skill 未审核 → 无法被生产 Agent 加载；审核发布后新版本草稿可绑定 |
| AT-10 | P0 | 方案 Agent 查询历史资料 → 返回结果按员工 ACL 过滤，不泄露无权方案 |
| AT-11 | P0 | Agent 发布 v2 时存在运行中的 v1 任务 → v1 继续引用旧快照；新任务引用 v2 |
| AT-12 | P0 | 员工提交任务后关闭页面 → Runner 继续执行；重新打开可查看进度/成果 |
| AT-13 | P0 | 同一海报任务连续修改 → 复用会话，能沿用先前文件和需求 |
| AT-14 | P0 | 沙盒回收后再次修改 → 可恢复已保存 Session/文件，不读取其他用户数据 |
| AT-15 | P0 | Runner 在任务执行中重启 → 任务状态变 `interrupted` 或安全恢复，不能悄然标记成功 |
| AT-16 | P0 | Builder 创建可执行脚本 → 仅能在构建沙盒测试，无法访问宿主机密钥或 Docker Socket |
| AT-17 | P0 | 员工没有 Builder 角色 → Studio 页面和相关 API 均拒绝访问 |
| AT-18 | P0 | 使用伪造 Tool 参数访问未授权资源 → Tool Gateway 在执行前拒绝 |
| AT-19 | P0 | 备份后恢复到测试环境 → 账号、发布版本、文件元数据及文件内容一致 |
| AT-20 | P0 | 全新服务器按 README 使用 Docker Compose 部署 → 无需 Redis/S3/MQ 即可运行示例闭环 |
| AT-21 | P1 | Builder 生成独立 React 业务页面 → 在隔离构建和安全审核后可受控发布 |
| AT-22 | P1 | 员工提交新 Agent 需求 → 管理员可评估、分派、回馈状态 |

**测试至少覆盖**：单元（Policy/Registry/文件 ACL）、集成（Task/Runner/Tool Gateway/沙盒）、E2E（Builder→审核→发布→员工交付）、安全回归（越权/路径/提示词注入/恶意 Skill/凭证泄露）、重启恢复。

## 13. 分阶段交付（功能切片，非强制日历）

### M0 基础骨架

- Web、登录与角色、SQLite、个人文件目录、Runner、Pi 最小会话、基本日志与 Docker Compose。
- 验收：两个用户登录与文件隔离；一个受限工具型 Agent 可安全运行。

### M1 真实业务 Agent 闭环

- Agent Registry、手工录入测试定义、UI Schema 渲染、海报 Tool、Task/SSE/成果、版本发布、工具授权。
- 验收：管理员发布海报 Agent；普通员工生成和修改海报、不能越权。

### M2 Forgegent Studio 闭环（V1 核心）

- Builder 对话创建/修改 Agent、生成 Skill 与 UI Schema、测试预览、审核、打包发布。
- 验收：不通过手工改业务代码，Builder 可以从自然语言创建新 Agent 并交给员工使用。

### M3 企业资源和治理

- 历史方案资料授权、方案生成 Agent、Skill 投稿审核、会话复用/沙盒回收、导入导出、备份、安全回归。
- 验收：方案 Agent 仅使用授权历史资料生成 DOCX，权限与用户文件隔离测试通过。

### P1 增强

- 生成自定义 React UI（独立隔离部署）、更多资源连接器、组织级审计和使用分析、企业 SSO、OpenTelemetry、gVisor/MicroVM 适配、S3/PostgreSQL/队列适配器。**P1 不阻塞 V1 发布。**

## 14. 完成定义（Definition of Done）

V1 被判定“完成”必须同时满足：

1. 三种角色权限与 API 层授权有效；普通员工无法自行创建/发布/修改 Agent。
2. Builder 能通过对话生成并迭代**至少两种不同任务 UI 的 Agent**（海报与方案），不依赖修改平台源码。
3. Agent Package 可审核、发布、回滚、导入/导出；发布快照不可变。
4. 已发布 Agent 自主调用授予的 Skills/Tools，未授权 Tool/数据/模型被执行层拒绝。
5. 多用户 Session、工作目录和个人文件强隔离；Builder/代码执行使用沙盒。
6. 任务可在后台执行，支持进度、结果、继续修改、取消、明确中断状态。
7. Docker Compose 单机可安装，默认仅依赖 Web、Runner、SQLite、本地文件和沙盒运行环境。
8. AT-01 至 AT-20 全部通过，并有可复现的测试日志、README、备份/恢复与安全部署说明。

## 15. 默认设计决策与后续扩展边界

| 决策点 | V1 默认值 | 可扩展方向 |
|---|---|---|
| 部署 | 单企业独立部署、单 Runner | 多实例、SaaS 多租户 |
| 主数据库 | SQLite WAL | PostgreSQL |
| 任务分发 | SQLite 任务表 + 单 Runner | MQ/Redis |
| 文件系统 | Local Workspace | S3/MinIO |
| 身份管理 | Next.js 内嵌轻量认证 | OIDC/企业微信/SSO |
| Agent 内核 | pi-coding-agent SDK | 通过 Runtime Adapter 替换 |
| UI 构建 | Schema + 标准组件模板 | 隔离的自定义 React 应用 |
| 沙盒 | Rootless Docker（按会话、按需） | gVisor/MicroVM、容器池 |
| 资源接入 | 上传文件/共享资料/审核 HTTP Tool | 连接器、RAG、MCP |
| Skill 发布 | 管理员审批 + 锁版本 | 团队市场与自动评测 |

**最终设计判断**：V1 的主要研发投入应当集中在“Builder Agent 可靠生成完整 Agent 应用”“Agent 应用包的治理与发布”“员工专属 UI 与安全隔离”，而不是搭建庞大的基础设施。
