# audit-observability Spec

## Purpose

审计与可观测性：安全与治理事件的全面留痕（脱敏）、模型与工具用量记录、最小可观测字段集，以及 V1 的结构化日志 + SQLite 审计表实现形态。

## ADDED Requirements

### Requirement: 审计事件覆盖

审计日志 MUST 覆盖：发布、审核结论、权限拒绝、敏感操作与运行失败；每条含时间、行为者、动作、资源标识、决定与原因；MUST NOT 记录秘密值。

#### Scenario: 敏感操作留痕
- **WHEN** Admin 执行发布、下架或撤销操作
- **THEN** 审计日志记录操作者、对象、时间与结论

#### Scenario: 日志脱敏
- **WHEN** 任何审计或运行日志写入
- **THEN** 凭证、密钥与敏感路径不以明文出现

### Requirement: 用量与成本记录

系统 MUST 按 task 记录 model、input_tokens、output_tokens 与费用估算；Admin SHALL 能按任务查询事件、输入输出文件与费用估算。

#### Scenario: 按任务查用量
- **WHEN** Admin 打开某任务的详情审计视图
- **THEN** 可见该任务的模型 Token 消耗与费用估算

### Requirement: 最小可观测字段

运行记录 MUST 至少含 `request_id`、`task_id`、`agent_release_id`、阶段耗时、模型 Token、Tool 调用次数、错误类型与拒绝操作数。

#### Scenario: 任务全链路可查
- **WHEN** 一个任务失败并需要排查
- **THEN** 上述字段可在日志与任务事件中检索到

### Requirement: V1 可观测实现形态

V1 SHALL 使用结构化 JSON 日志 + SQLite 审计表满足以上要求；OpenTelemetry/Grafana 属 P1，不在本能力范围。

#### Scenario: 无外部观测依赖部署
- **WHEN** 平台以 Docker Compose 单机部署
- **THEN** 审计与用量查询不依赖任何外部观测基础设施即可工作
