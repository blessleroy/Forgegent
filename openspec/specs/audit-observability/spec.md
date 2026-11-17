# audit-observability Specification

## Purpose
审计与可观测性：安全与治理事件的全面留痕（脱敏）、模型与工具用量记录、最小可观测字段集，以及 V1 的结构化日志 + SQLite 审计表实现形态。

## Requirements

### Requirement: 审计事件覆盖

审计日志 MUST 覆盖：发布、审核结论、权限拒绝、敏感操作与运行失败；每条含时间、行为者、动作、资源标识、决定与原因；MUST NOT 记录秘密值。

#### Scenario: 敏感操作留痕
- **WHEN** Admin 执行发布、下架或撤销操作
- **THEN** 审计日志记录操作者、对象、时间与结论

#### Scenario: 日志脱敏
- **WHEN** 任何审计或运行日志写入
- **THEN** 凭证、密钥与敏感路径不以明文出现

### Requirement: 用量与成本记录

每个任务 MUST 落 `usage_records`（模型、输入/输出 Token、估算成本）；`estimated_cost` MUST 依模型资源配置单价计算（未配置单价时为 0 且事件注明「未配置单价」）；成本用于费用预算判定（D44）。

#### Scenario: 按任务查用量

- **WHEN** 管理员查询某任务的用量记录
- **THEN** 记录含模型、Token 数与按单价计算的成本（或注明未配置单价）

### Requirement: 最小可观测字段

可观测记录 MUST 覆盖 `request_id`、`task_id`、`agent_release_id`、阶段耗时、模型 Token、工具调用次数（真实逐次调用计数，非产物数量）、错误类型与拒绝操作数（按任务/时间窗口可聚合查询，非仅逐条日志）；结构化 JSON 日志 MUST 在生产路径统一经脱敏器输出（秘密形状键值/字符串擦除），MUST NOT 存在生产旁路日志。

#### Scenario: 任务全链路可查

- **WHEN** 管理员按任务查询观测数据
- **THEN** 该任务的阶段耗时、Token 消耗、工具真实调用次数、错误类型与被拒绝操作计数齐全，且日志中无明文凭证

### Requirement: V1 可观测实现形态

V1 SHALL 使用结构化 JSON 日志 + SQLite 审计表满足以上要求；OpenTelemetry/Grafana 属 P1，不在本能力范围。

#### Scenario: 无外部观测依赖部署
- **WHEN** 平台以 Docker Compose 单机部署
- **THEN** 审计与用量查询不依赖任何外部观测基础设施即可工作

### Requirement: 审计页运行失败查询

管理员审计页 SHALL 支持查询运行失败类事件（`run.failed` 等）与按动作类型过滤（现有 decision/actor 过滤之外增加 action 维度），使"运行失败日志"（PRD §4 /admin/audit 职责）在一处可查。

#### Scenario: 管理员可查任务失败记录

- **WHEN** 管理员在审计页按动作 `run.failed` 过滤
- **THEN** 列表展示失败任务的事件（时间、任务、错误类型、脱敏原因），可与权限拒绝事件交叉查询
