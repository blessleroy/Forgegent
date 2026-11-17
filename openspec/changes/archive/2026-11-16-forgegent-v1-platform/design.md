# Design

## Context

绿地项目，无存量代码。约束来源：`Forgegent_V1_AI_PRD.md`（技术架构 §7、数据模型 §9、默认决策 §15、沙盒 §5.8）与 le-spec 访谈确认的决策 D1–D27（见 `openspec/le-spec/state.md`）。核心外部事实已核实：Agent 内核为 npm 包 `@earendil-works/pi-coding-agent`（SDK 提供 `createAgentSession`、`DefaultResourceLoader`（支持 `skillsOverride`/`systemPromptOverride`）、`SessionManager`（内存/持久化）、`ModelRuntime`（自定义端点/API key）、`defineTool`/`customTools`/`tools` 白名单；该包历史上迁移过 npm scope，旧教程指向废弃包——必须锁版本并以官方文档为准）。

**编号约定**：本文 Decisions 使用 D1–D10 指代本文件内架构决策；引用需求层决策时以 `state.md` 的 D1–D27 为准（两个编号空间独立，正文引用 state 决策时均显式注明"state Dxx"）。

## Goals / Non-Goals

**Goals:**
- 单仓库、双进程（Next.js Web + Node.js Runner）+ 按需沙盒容器的可部署架构
- 权限与安全在服务端/执行端集中落实（Tool Gateway 为唯一工具执行路径）
- 以 pi SDK 原生扩展点（customTools、ResourceLoader、SessionManager、ModelRuntime）实现平台治理，避免 fork SDK
- M0→M3 交付切片可在同一架构上渐进完成

**Non-Goals:**
- 多机/高可用/SaaS 多租户、容器预热池、运行时 kill-switch、任务/文件共享（V1 明确不做）
- 自定义 React 页面生成（P1）、OpenTelemetry（P1）、专用连接器/RAG（P1）
- 指令级崩溃恢复（只做持久化上下文恢复）

## Decisions

### D1. 单体 Web + 独立 Runner 进程（PRD §7）

Next.js 单体承载 Web/API/Auth/Permission Manager/Registry；Runner 为独立常驻 Node 进程，轮询 SQLite 任务表。**替代方案**：Web 进程内嵌 Agent 执行（实现最快，但 Agent 崩溃拖垮 Web、无法独立伸缩与沙盒管理）/ 微服务（PRD 明令禁止）。Runner 与 Web 仅通过 SQLite + 文件系统协作，无 MQ、无额外内部 API——Web 侧写入的控制信号（cancel/continue 等）通过 SQLite 任务状态与事件表落地，Runner 轮询感知并执行。

### D2. pi SDK 集成：扩展点注入而非 fork

- **restricted 模式**：Runner 进程内 `createAgentSession({ tools: [白名单], customTools: [平台封装工具], resourceLoader, sessionManager, modelRuntime })`；平台工具全部经 `defineTool` 封装并在 handler 内调用 Tool Gateway 校验。
- **sandboxed 模式**：Pi 与脚本在按会话容器内执行，容器仅获得受控代理端点（模型代理 + 文件 API），无宿主凭证。
- **Skill 注入**：`DefaultResourceLoader.skillsOverride` 替换为"从发布快照读取已审核 Skill 版本（含哈希校验）"的加载器——满足"未审核不进生产 ResourceLoader"。
- **模型接入**：`ModelRuntime.create({ authPath, modelsPath })` 指向平台生成的运行时配置（OpenAI 兼容自定义 base URL + images 端点，D11/D16），key 经 `setRuntimeApiKey` 注入，不落沙盒。
- **会话持久化**：`SessionManager` 指向任务 workspace 下的 session 文件，支撑崩溃恢复与 continue 复用。

**替代方案**：fork SDK 深度改造（维护成本高、上游演进快）/ RPC 模式驱动 Pi CLI（进程管理复杂，SDK 类型安全更佳）。

### D3. SQLite WAL + Drizzle + 租约调度（PRD §15）

单 SQLite（WAL 模式）承载全部元数据；Runner 以 `lease_until` 租约领取任务、短周期轮询、并发上限可配（默认 5）、同 session 独占锁。**替代方案**：Redis/BullMQ（PRD 禁入）。表集在 PRD §9 基础上补充：`departments`/`user_departments`（N3）、`task_file_refs`（D23）、`studio_conversations`（N4）、`tasks.origin`（staff/test，N4）。

### D4. 发布快照 = 本地只读目录 + 清单校验和

发布时将应用包（manifest/prompts/ui/skills/tests/assets）写入 `releases/<id>/` 不可变目录并记录 checksum；Task 记录 `agent_release_id`，执行时只加载该快照。回滚 = 切 `agents.active_release_id` 指针。导出 = 快照打包 + 脱敏（去 modelRef 解析物/凭证/内部身份）；导入 = 新草稿。

### D5. Tool Gateway 为唯一工具执行路径（FR-09.3 落地方式）

所有平台工具（含生图、HTTP API 工具、文件读写、检索）实现为 Gateway 后的 `customTools`：handler 先做 用户∩Release∩Task 权限校验与出网白名单校验，再代理执行；拒绝走审计。restricted 白名单即 `tools` 参数允许集；沙盒内工具经容器内代理回宿主 Gateway。HTTP API 工具以声明式配置（端点/方法/参数 JSON Schema/鉴权类型）注册（D26），凭证只存服务端。

### D6. 沙盒：Docker Rootless 按会话容器（PRD §5.8）

每工作会话一个容器（首轮按需启动、复用、空闲 15 分钟回收）；非特权、最小 capabilities、seccomp、资源上限、出网白名单（仅模型代理与必要目标）；禁挂载 Docker Socket/生产密钥/整用户目录；镜像预装。执行后端抽象为接口（默认 Rootless Docker，可替换 gVisor/MicroVM）。**替代方案**：宿主内 nsjail/seccomp 直接隔离（隔离强度不足且平台耦合高）。

### D7. 认证 Better Auth + SQLite；初始 Admin 环境变量（D14）

Better Auth 承载登录/会话/密码哈希（bcrypt 等价）；`FORGEGENT_ADMIN_EMAIL/PASSWORD` 环境变量在空用户表时创建初始 Admin，首登强制改密。**替代方案**：自研 session（PRD 允许但重复造轮）/ Keycloak（禁入）。

### D8. 交互模型：事件表统一 SSE + 消息式 continue（D27/D17）

`task_events` 为唯一事件源（进度/工具/产物/Agent 消息），SSE 按事件 ID 增量推送、断线补读；waiting_input 的 Agent 请求与终态后继续修改统一走 `POST /api/tasks/:id/continue`（自由文本，服务端校验不可改配置）；中间产物以事件附引用呈现于任务页产物区。不引入 WebSocket（单向推送足够，运维更简单）。

### D9. 前端：Schema 渲染器 + 双模板 + next-intl 双语

受控 UI Schema 渲染器（字段类型/校验/布局区块，D24 能力集）+ `form-result`/`document-flow` 两模板；平台 UI 文案全部过 i18n 层（next-intl 或同级），Agent 内容语言随 Builder。**替代方案**：每个 Agent 生成独立 React 页面（PRD P1，且安全审核成本高）。

### D10. 仓库形态：单 monorepo（pnpm workspace）

`apps/web`（Next.js）、`apps/runner`（Node 进程）、`packages/shared`（类型/权限/事件契约）、`packages/pi-adapter`（SDK 封装，隔离上游演进）。锁 `@earendil-works/pi-coding-agent` 精确版本，升级走适配层评审。

### D11. 里程碑过渡：M2 期 Builder Agent 先 restricted、M3 沙盒化

spec（sandbox-isolation）要求 Builder Agent 必须沙盒执行，但 Studio 闭环（M2）先于沙盒里程碑（M3）交付。过渡决策：M2 期间 Builder Agent 以 `restricted` 模式运行（仅白名单平台工具、无动态代码执行能力），M3 完成执行后端后将 Builder Agent 切换为 `sandboxed`；M2 验收不因此放宽 sandbox-isolation 的最终要求。

## Risks / Trade-offs

- [pi SDK 演进快、曾有 scope 迁移] → 锁精确版本 + `packages/pi-adapter` 隔离面 + 升级时对照官方 SDK 文档回归
- [Rootless 非强隔离充分条件] → FR-08 约束全量落实（非特权/seccomp/限网/最小挂载）+ 执行后端可替换接口
- [Builder Agent 生成质量不稳定] → 生成物必附测试用例 + 提审自动测试 + Admin 审核兜底；V1 不承诺全自动发布
- [自部署 OpenAI 兼容端点行为差异（含 images API）] → 配置保存时探活校验 + 明确错误信息；生图结果校验（MIME/大小）
- [单 Runner 吞吐上限] → 并发可配置 + 任务排队语义明确；多 Runner 属后续扩展
- [SQLite 并发写竞争（Web+Runner 双进程）] → WAL + busy_timeout + 写操作短事务
- [消息式交互（D27）弱于结构化确认的表达力] → 产物区结构化展示弥补；若后续需要，Schema 可加可选确认字段（向后兼容，已在 state 记录）

## Migration Plan

绿地无迁移。部署：README + Docker Compose（web/runner/volume + rootless docker daemon 前置说明）→ 环境变量初始 Admin → 管理端配置模型端点 → seed 示例闭环（D25）。回滚：代码层 git revert 重新部署；数据卷与 SQLite 独立持久化，不受应用回滚影响；发布版本回滚走平台指针切换。

## Open Questions

（无——可延后实现细节已由 N1–N7 默认值覆盖；pi SDK 具体版本号在 M0 首个任务中锁定并回归）
