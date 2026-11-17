# permission-enforcement Specification

## Purpose
Agent 级权限执行层：有效权限 = 用户 ∩ Agent 发布版本 ∩ 任务的三方交集、默认拒绝、Tool Gateway 逐调用校验、文件与检索 ACL、拒绝留痕——全部在服务端与执行端落实，不依赖 Prompt 或前端。

## Requirements

### Requirement: 三方权限交集与默认拒绝

有效权限 MUST 等于当前用户授权 ∩ Agent 发布版本授权 ∩ 当前任务授权；所有未列入白名单的操作 MUST 默认拒绝。

#### Scenario: 交集计算
- **WHEN** 用户对某资源有权、但当前 Agent 发布版本未声明该资源
- **THEN** 该 Agent 在此任务中对该资源的访问被拒绝

### Requirement: 无权不可见不可用

用户无 Agent 使用权限时，Hub MUST NOT 展示该 Agent，API MUST 拒绝创建任务。

#### Scenario: Hub 与 API 双重一致（AT-03 支撑）
- **WHEN** 未被授权的员工浏览 Hub 或直接调用任务创建 API
- **THEN** Hub 不显示该应用，API 返回拒绝

### Requirement: 能力锁定

Agent 只能使用其发布版本指定的模型、Skills、Tools、资源与网络目标；用户提示词 MUST NOT 增加这些能力。

#### Scenario: 伪造配置变更无效（AT-06）
- **WHEN** 员工伪造 API 调用尝试更改模型/Skill/Tool 配置
- **THEN** 返回 403 或相应拒绝，生产配置不变

### Requirement: Tool Gateway 逐调用校验

每次 Tool 调用 MUST 由可信服务端 Gateway 校验用户/Agent/Task/动作/资源/参数；Gateway 上下文中的用户角色 MUST 取任务所有者的真实角色集合（服务端实时计算），MUST NOT 使用硬编码常量角色；校验依据（工具白名单、出网白名单、文件 ACL）MUST 来自发布快照与任务上下文，MUST NOT 被 Prompt 或工具描述扩大。

#### Scenario: 伪造参数执行前拦截

- **WHEN** 模型以伪造的 fileId/出网目标调用工具
- **THEN** Gateway 在执行前拒绝并留痕

#### Scenario: 上下文角色真实

- **WHEN** Admin 本人创建的任务在运行中触发工具调用
- **THEN** Gateway 上下文记录该 Admin 的真实角色集合（而非固定占位角色），权限判定结果不变地遵循交集规则

### Requirement: 文件与数据访问 ACL

文件访问、企业资料检索、下载与写入 MUST 检查发起用户的 ACL；Agent 连接了某数据源 MUST NOT 等同于用户拥有该源全部数据的访问权。

#### Scenario: 连库不等于全量访问
- **WHEN** Agent 绑定了历史方案库，但发起员工仅对部分方案有 ACL
- **THEN** 该员工任务中仅能检索到其有权访问的方案（AT-10）

### Requirement: 拒绝与安全事件留痕

拒绝事件 MUST 记录到审计日志，含时间、用户、Agent、动作、资源标识与原因，MUST NOT 记录秘密值。

#### Scenario: 越权尝试可追溯
- **WHEN** 任意权限拒绝发生
- **THEN** 审计日志含完整追查要素且不含任何凭证内容

### Requirement: 业务职责共同约束

Agent 的业务职责（如只做海报）MUST 通过 UI Schema、任务类型、系统指令与结构化输出校验共同约束；系统 MUST NOT 声称仅靠 Prompt 可百分百避免回答偏题。

#### Scenario: 偏题输出被结构化校验拦截
- **WHEN** 海报 Agent 输出不含图像产物的响应
- **THEN** 结构化输出校验判定不合规并按失败处理，而非静默接受
