# task-execution Delta

## MODIFIED Requirements

### Requirement: 任务状态机

任务状态 MUST 覆盖 `pending`、`starting`、`running`、`waiting_input`、`completed`、`failed`、`cancelled`、`interrupted` 八态。合法迁移 MUST 为：`pending → starting → running`；`running → waiting_input`（Agent 请求输入）与 `waiting_input → running`（员工回复）；`running/waiting_input/pending/starting → cancelled`（用户或 Admin 取消）；`running/waiting_input → failed`（失败/超时/超预算）；执行中 Runner 崩溃或租约失效 → `interrupted`；四种终态（`completed/failed/cancelled/interrupted`）均可经 continue → `running`。所有状态写入（包括 Runner 完成租约时的终态落库）MUST 经状态机迁移校验；对已处终态的任务 MUST NOT 覆写为另一终态。

#### Scenario: 正常生命周期

- **WHEN** 员工提交一个海报生成任务并等待完成
- **THEN** 任务从 `pending` 经 `running` 到达 `completed`，全程状态可查询

#### Scenario: 非法迁移被拒

- **WHEN** 系统收到不符合上表的状态变更（如 `completed → pending`）
- **THEN** 状态机拒绝该变更并记录异常事件

#### Scenario: 取消后不被完成态覆写

- **WHEN** 员工对一个 `running` 任务取消成功（状态已为 `cancelled`），随后仍在执行的这一轮结束并报告"成功"
- **THEN** 终态落库被状态机拒绝，任务保持 `cancelled`；已完成轮次产生的已转存成果保留

### Requirement: waiting_input 与消息式继续交互

Agent 需要员工输入时任务 MUST 进入 `waiting_input` 并以 Agent 消息呈现请求（可附阶段产物预览）；员工以自由文本回复；运行中回复与终态后继续修改 MUST 统一通过同一消息/continue 端点提交。员工消息 MUST NOT 能修改模型、工具、资源或执行策略（服务端校验）。中间产物（如大纲、海报草稿）MUST 经任务事件在产物区展示。

生产执行路径 MUST 真实产生 `waiting_input`：平台向 Agent 会话注入经 Tool Gateway 白名单的 `request_input` 挂起工具；Agent 调用该工具提交中间产物（payload 含 `kind` 字段区分轮次，如 outline/draft）即视为请求输入，执行器 MUST 以该工具调用事件为准将任务转入 `waiting_input` 并结束本轮（工具调用之后的模型输出 MUST NOT 改变这一判定）。`waiting_input` MUST 释放任务租约与并发执行槽（不计入并发执行上限），同时保留该工作会话的独占语义；`waiting_input` MUST NOT 自动超时，挂起至员工 continue 或取消。

#### Scenario: 运行中回复排队投递（D40）

- **WHEN** 员工在任务 `running` 期间（尚未进入 `waiting_input`）发送消息
- **THEN** 消息被记录为任务事件并排队，在任务进入 `waiting_input` 或本轮结束后的 resume 中投递给模型；MUST NOT 注入正在流式的当前轮（不做即时 steer）

#### Scenario: 等待任务不占并发槽

- **WHEN** 5 个任务中 2 个处于 `waiting_input`，同时新任务进入队列
- **THEN** 新任务可被立即领取执行（并发上限仅计执行中的任务），等待任务恢复时重新领取

#### Scenario: 大纲确认流（§3.2）

- **WHEN** 方案 Agent 生成大纲后调用 `request_input` 提交大纲
- **THEN** 任务进入 `waiting_input` 并释放并发槽，员工在任务页消息区看到大纲预览并以文本回复确认或修改意见，任务恢复执行且沿用同一会话上下文

#### Scenario: 终态后继续修改（AT-13）

- **WHEN** 员工对一个 `completed` 任务发送"把标题改为 X 并重新导出"
- **THEN** 系统复用同一任务记录与工作会话继续执行，沿用先前文件与需求，任务回到 `running`

### Requirement: continue 语义与适用终态

`completed`、`failed`、`interrupted`、`cancelled` 四种终态的任务 SHALL 均可 continue；continue MUST 复用同一 task 记录与 session 并使状态回到 `running`；每次 continue 是同任务的新一轮执行，任务列表保持单条记录滚动更新。continue MUST 通过平台的会话恢复机制把既有上下文（历史消息、中间产物、已授权文件引用）与员工回复一并交给模型——员工回复 MUST 进入模型上下文，MUST NOT 以原始输入摘要替代重跑。

#### Scenario: 失败任务修复后续跑

- **WHEN** 员工对一个因输入缺失而 `failed` 的任务补充说明后 continue
- **THEN** 任务复用原会话恢复执行而非新建任务，且补充说明成为本轮模型输入的一部分

#### Scenario: 排队消息随恢复投递

- **WHEN** 员工在任务运行中发送的消息在任务进入 `waiting_input` 后回复"就按我刚才说的办"
- **THEN** 恢复执行时排队消息与本次回复一起进入模型上下文

### Requirement: 用户取消

员工 SHALL 能取消自己的任务；取消后系统 MUST 阻止新的工具操作并尽力中止当前可中断操作。取消 MUST 尽力中止底层模型执行（传播中止信号）；无法立即中止时，后续终态落库 MUST 遵守状态机（不得覆写 `cancelled`）。

#### Scenario: 取消生效

- **WHEN** 员工对一个 `running` 任务点击取消
- **THEN** 任务进入 `cancelled`，不再产生新的工具调用；已转存到员工个人空间的成果保留，任务临时目录与沙盒按清理规则回收

### Requirement: SSE 脱敏推送与补读

进度、工具状态与成果 MUST 通过 SSE 推送，内容经过过滤：MUST NOT 暴露模型私有推理原文、环境变量、凭证与敏感路径。所有进入事件流的 `safe_payload` MUST 经过与审计日志一致的脱敏处理（秘密形状键值/字符串擦除）；失败原因 MUST NOT 携带绝对路径或环境细节原文（以脱敏/归类后的结构化原因呈现）。任务事件 MUST 持久化并支持按事件 ID 补读；SSE 断线重连 MUST NOT 造成任务重复执行。

#### Scenario: 断线补读不重复执行

- **WHEN** 员工页面在网络中断后重连并请求缺失事件
- **THEN** 客户端按事件 ID 补齐进度，任务本身未受任何重复执行影响

#### Scenario: 失败原因脱敏

- **WHEN** 任务因快照完整性错误失败，底层异常信息包含宿主绝对路径
- **THEN** 事件流中的失败原因不含该绝对路径，仅保留归类后的错误类型与脱敏说明

### Requirement: 单 Runner SQLite 队列调度

V1 SHALL 使用 SQLite 待执行任务表 + 单实例 Runner：轮询领取任务、并发上限默认 5 且可配置、租约与 `lease_until` 防重复领取；同一工作会话 MUST 加独占锁，禁止两个请求同时修改一个 Session。不引入 Redis 或 MQ。任务执行期间调度器 MUST 持续领取新任务直至并发上限（长任务执行 MUST NOT 使领取停摆）；已领取任务 MUST 在执行期间周期性续租，租约时长 MUST 覆盖长任务执行（防误判 `interrupted`）。`waiting_input` 不占执行槽（见 waiting_input 需求）。

#### Scenario: 并发上限生效

- **WHEN** 同时提交超过并发上限的任务
- **THEN** 超出部分保持 `pending` 等待，已有任务互不干扰（AT-07 支撑）

#### Scenario: 长任务期间继续领取

- **WHEN** 一个执行中的任务耗时超过一个调度周期，同时队列中存在新任务且未达并发上限
- **THEN** 调度器在长任务执行期间领取并开始执行新任务

#### Scenario: 长任务租约不失效

- **WHEN** 任务执行时长超过初始租约时长但仍在正常执行与续租
- **THEN** 任务不会被回收逻辑误判为 `interrupted`

### Requirement: 预算与时长上限

每个任务 MUST 有最大时长、Token/费用预算与文件容量上限；最大时长与预算 MUST 仅按执行时间与消耗计——`waiting_input` 挂起时间 MUST NOT 计入最大时长；超限时系统 MUST 安全终止并以结构化原因说明（任务进入 `failed`，员工可 continue 或新建任务重试）。`maxDurationSeconds` MUST 在执行期强制生效（而非仅事后检查）；`maxCostCents` 依模型资源配置的单价计算生效——未配置单价时费用预算 MUST NOT 触发，且事件中注明「未配置单价，费用预算未生效」；工具调用次数 MUST 按真实调用计数（非产物数量）。

#### Scenario: 超预算安全终止

- **WHEN** 任务 Token 消耗超过配置预算
- **THEN** 任务安全终止为 `failed` 并展示超限原因，员工可基于同会话重试

#### Scenario: 等待不计入时长

- **WHEN** 任务在 `waiting_input` 挂起超过最大时长配置值后员工回复
- **THEN** 任务恢复执行，不因挂起时长被终止

#### Scenario: 执行期时长强制

- **WHEN** 任务实际执行时长达到 `maxDurationSeconds`
- **THEN** 执行被中止、任务进入 `failed` 并附结构化原因，而非待整轮自然结束后才检查

### Requirement: 外部操作幂等

外部生成操作 MUST 使用任务级幂等键、结果校验与必要的人工重试提示；幂等记录 MUST 持久化存储（跨 Runner 重启存活）；已执行但结果未知的外部操作 MUST NOT 盲目自动重试——先查询幂等记录（命中则复用既有结果），必要时标记人工重试。

#### Scenario: 结果未知不重复扣费

- **WHEN** 一次生图调用超时且结果未知后任务重试
- **THEN** 系统先查幂等记录，不会盲目重发导致重复扣费

#### Scenario: Runner 重启后重试不重复调用

- **WHEN** 生图调用结果未知后 Runner 重启，任务经 continue 恢复并重试
- **THEN** 系统命中持久化的幂等记录，不向外部生图服务重复发起调用

## ADDED Requirements

### Requirement: 产物存储统一

Runner 产物转存与 Web 文件服务 MUST 使用同一存储根（同一 `files` 目录与 FileStore 约定）；任务产物经服务端校验转存到员工个人空间后，员工 MUST 能从文件接口正常下载（下载不再因存储根错位而失败）。

#### Scenario: 任务产物可下载（AT-04 补全）

- **WHEN** Runner 完成一个海报任务并将产物转存个人空间
- **THEN** 员工在任务页/文件页下载该产物成功，内容与产物一致

### Requirement: 输入文件授权副本投递

任务开始执行时，系统 MUST 将该任务已授权的输入文件以副本形式投递到任务工作区（Agent 可读取内容），且副本范围 MUST 限于该任务引用的文件——MUST NOT 挂载或暴露员工整个文件目录；任务结束后临时副本按清理规则回收，成果按转存规则写回个人空间（FR-07.3）。

#### Scenario: 上传文件进入任务工作区

- **WHEN** 员工在方案 Agent 任务页上传客户需求文件并提交任务
- **THEN** 该文件副本出现在任务工作区并作为模型可读输入，员工其他文件不可见
