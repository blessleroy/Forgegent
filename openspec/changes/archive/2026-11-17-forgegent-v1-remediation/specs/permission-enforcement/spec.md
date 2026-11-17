# permission-enforcement Delta

## MODIFIED Requirements

### Requirement: Tool Gateway 逐调用校验

每次 Tool 调用 MUST 由可信服务端 Gateway 校验用户/Agent/Task/动作/资源/参数；Gateway 上下文中的用户角色 MUST 取任务所有者的真实角色集合（服务端实时计算），MUST NOT 使用硬编码常量角色；校验依据（工具白名单、出网白名单、文件 ACL）MUST 来自发布快照与任务上下文，MUST NOT 被 Prompt 或工具描述扩大。

#### Scenario: 伪造参数执行前拦截

- **WHEN** 模型以伪造的 fileId/出网目标调用工具
- **THEN** Gateway 在执行前拒绝并留痕

#### Scenario: 上下文角色真实

- **WHEN** Admin 本人创建的任务在运行中触发工具调用
- **THEN** Gateway 上下文记录该 Admin 的真实角色集合（而非固定占位角色），权限判定结果不变地遵循交集规则
