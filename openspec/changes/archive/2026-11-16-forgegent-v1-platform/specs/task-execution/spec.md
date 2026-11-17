# task-execution Spec

## Purpose

任务运行时核心：任务创建绑定发布快照、八态状态机、后台执行与 SSE 脱敏推送、消息式继续交互（waiting_input 与终态后统一消息流）、取消与恢复、SQLite 队列 + 单 Runner 租约调度、幂等与预算约束。

## ADDED Requirements

### Requirement: 任务创建与记录

创建任务时系统 MUST 校验用户对该 Agent 的使用权及本次上传/资源访问权，并记录 `owner_id`、`agent_release_id`、输入摘要、文件引用、资源授权上下文、状态、预算与执行模式。

#### Scenario: 无权创建被拒（FR-09.1）
- **WHEN** 员工请求以无使用权的 Agent 创建任务
- **THEN** API 拒绝创建并留痕

### Requirement: 任务可见性与管理权限

任务及其事件 MUST 仅对任务所有者与 Admin 可见（V1 不做任务共享）；任务取消 MUST 支持所有者与 Admin 两种发起者。

#### Scenario: 他人任务不可见
- **WHEN** 员工 A 尝试查看或取消员工 B 的任务
- **THEN** 系统拒绝访问；Admin 发起取消则被允许

### Requirement: 任务状态机

任务状态 MUST 覆盖 `pending`、`starting`、`running`、`waiting_input`、`completed`、`failed`、`cancelled`、`interrupted` 八态。合法迁移 MUST 为：`pending → starting → running`；`running → waiting_input`（Agent 请求输入）与 `waiting_input → running`（员工回复）；`running/waiting_input/pending/starting → cancelled`（用户或 Admin 取消）；`running/waiting_input → failed`（失败/超时/超预算）；执行中 Runner 崩溃或租约失效 → `interrupted`；四种终态（`completed/failed/cancelled/interrupted`）均可经 continue → `running`。

#### Scenario: 正常生命周期
- **WHEN** 员工提交一个海报生成任务并等待完成
- **THEN** 任务从 `pending` 经 `running` 到达 `completed`，全程状态可查询

#### Scenario: 非法迁移被拒
- **WHEN** 系统收到不符合上表的状态变更（如 `completed → pending`）
- **THEN** 状态机拒绝该变更并记录异常事件

### Requirement: 后台执行独立于页面

Web 关闭 MUST NOT 终止正在执行的任务；员工重新打开 MUST 能查看进度与成果（AT-12）。

#### Scenario: 关页后任务继续
- **WHEN** 员工提交任务后立即关闭浏览器页面
- **THEN** Runner 继续执行至终态，员工稍后重新打开可见进度与成果

### Requirement: waiting_input 与消息式继续交互

Agent 需要员工输入时任务 MUST 进入 `waiting_input` 并以 Agent 消息呈现请求（可附阶段产物预览）；员工以自由文本回复；运行中回复与终态后继续修改 MUST 统一通过同一消息/continue 端点提交。员工消息 MUST NOT 能修改模型、工具、资源或执行策略（服务端校验）。中间产物（如大纲、海报草稿）MUST 经任务事件在产物区展示。

#### Scenario: 大纲确认流（§3.2）
- **WHEN** 方案 Agent 生成大纲后需要员工确认
- **THEN** 任务进入 `waiting_input`，员工在任务页消息区看到大纲预览并以文本回复确认或修改意见，任务恢复 `running`

#### Scenario: 终态后继续修改（AT-13）
- **WHEN** 员工对一个 `completed` 任务发送"把标题改为 X 并重新导出"
- **THEN** 系统复用同一任务记录与工作会话继续执行，沿用先前文件与需求，任务回到 `running`

### Requirement: continue 语义与适用终态

`completed`、`failed`、`interrupted`、`cancelled` 四种终态的任务 SHALL 均可 continue；continue MUST 复用同一 task 记录与 session 并使状态回到 `running`；每次 continue 是同任务的新一轮执行，任务列表保持单条记录滚动更新。

#### Scenario: 失败任务修复后续跑
- **WHEN** 员工对一个因输入缺失而 `failed` 的任务补充说明后 continue
- **THEN** 任务复用原会话恢复执行而非新建任务

### Requirement: 用户取消

员工 SHALL 能取消自己的任务；取消后系统 MUST 阻止新的工具操作并尽力中止当前可中断操作。

#### Scenario: 取消生效
- **WHEN** 员工对一个 `running` 任务点击取消
- **THEN** 任务进入 `cancelled`，不再产生新的工具调用；已转存到员工个人空间的成果保留，任务临时目录与沙盒按清理规则回收

### Requirement: SSE 脱敏推送与补读

进度、工具状态与成果 MUST 通过 SSE 推送，内容经过过滤：MUST NOT 暴露模型私有推理原文、环境变量、凭证与敏感路径。任务事件 MUST 持久化并支持按事件 ID 补读；SSE 断线重连 MUST NOT 造成任务重复执行。

#### Scenario: 断线补读不重复执行
- **WHEN** 员工页面在网络中断后重连并请求缺失事件
- **THEN** 客户端按事件 ID 补齐进度，任务本身未受任何重复执行影响

### Requirement: 崩溃恢复与 interrupted

Session 与任务成果 MUST 持久化；Runner 崩溃后未完成任务 MUST 被标记为 `interrupted`，允许安全重试或继续（可恢复已持久化上下文与文件）；系统 MUST NOT 宣称或尝试任意工具调用中间指令级精确恢复；中断任务 MUST NOT 被悄然标记成功（AT-15）。

#### Scenario: Runner 重启后状态明确
- **WHEN** Runner 在任务执行中重启
- **THEN** 该任务状态为 `interrupted`（或安全恢复继续执行），绝不显示为 `completed`

#### Scenario: 沙盒回收后可恢复（AT-14）
- **WHEN** 员工在沙盒回收后对任务继续修改
- **THEN** 系统恢复已保存的 Session 与文件继续执行，且不读取其他用户数据

### Requirement: 单 Runner SQLite 队列调度

V1 SHALL 使用 SQLite 待执行任务表 + 单实例 Runner：轮询领取任务、并发上限默认 5 且可配置、租约与 `lease_until` 防重复领取；同一工作会话 MUST 加独占锁，禁止两个请求同时修改一个 Session。不引入 Redis 或 MQ。

#### Scenario: 并发上限生效
- **WHEN** 同时提交超过并发上限的任务
- **THEN** 超出部分保持 `pending` 等待，已有任务互不干扰（AT-07 支撑）

### Requirement: 外部操作幂等

外部生成操作 MUST 使用任务级幂等键、结果校验与必要的人工重试提示；已执行但结果未知的外部操作 MUST NOT 盲目自动重试——先查询幂等记录，必要时标记人工重试。

#### Scenario: 结果未知不重复扣费
- **WHEN** 一次生图调用超时且结果未知后任务重试
- **THEN** 系统先查幂等记录，不会盲目重发导致重复扣费

### Requirement: 预算与时长上限

每个任务 MUST 有最大时长、Token/费用预算与文件容量上限；最大时长与预算 MUST 仅按执行时间与消耗计——`waiting_input` 挂起时间 MUST NOT 计入最大时长；超限时系统 MUST 安全终止并以结构化原因说明（任务进入 `failed`，员工可 continue 或新建任务重试）。

#### Scenario: 超预算安全终止
- **WHEN** 任务 Token 消耗超过配置预算
- **THEN** 任务安全终止为 `failed` 并展示超限原因，员工可基于同会话重试

#### Scenario: 等待不计入时长
- **WHEN** 任务在 `waiting_input` 挂起超过最大时长配置值后员工回复
- **THEN** 任务恢复执行，不因挂起时长被终止
