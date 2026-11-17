# agent-registry Spec

## Purpose

Agent 应用包规范与发布治理：应用包构成、草稿到不可变发布快照的审核链、上下架与回滚、脱敏导入导出、发布范围授权，以及"运行时只接受已发布版本"的核心约束。

## ADDED Requirements

### Requirement: 应用包完整构成

每个 Agent 应用 MUST 具备唯一 ID、名称、描述、图标、归属、版本、模型配置、Skill/Tool 引用、UI Schema、资源授权声明与发布范围。清单中的 `modelRef`/`resourceRefs` 是能力引用，MUST NOT 包含密钥或真实组织内部路径。

#### Scenario: 应用包要素可校验
- **WHEN** 发布审核时检查一个应用包
- **THEN** 系统能验证上述要素齐全，且清单中不存在明文密钥或内部身份引用

### Requirement: 不可变发布快照

发布产物 MUST 为不可变版本快照；Task 创建时绑定具体版本；新发布 MUST NOT 改变进行中旧任务的行为。回滚仅切换活跃版本指针，历史成果与任务仍指向原版本。

#### Scenario: 并行版本互不影响（AT-11）
- **WHEN** Agent 发布 v2 时存在运行中的 v1 任务
- **THEN** v1 任务继续引用旧快照执行完成，新创建任务引用 v2

### Requirement: 审核通过后方可发布

Admin MUST 审核通过后才可发布；支持下架（阻止新任务创建，运行中任务按管理员明确的终止策略处理，默认允许安全完成）与指定版本回滚。

#### Scenario: 未审核草稿对员工不可见（AT-03）
- **WHEN** 一个草稿已提审但未获 Admin 批准
- **THEN** 员工 Hub 不可见该应用，且任何员工 API 尝试运行它都被拒绝

#### Scenario: 下架阻止新任务
- **WHEN** Admin 下架一个已发布应用
- **THEN** 员工无法再创建该应用的新任务，已运行任务按默认策略安全完成

### Requirement: 发布范围授权

发布对象 MUST 显式指定为全体员工、具体成员或部门；未显式授权的应用 MUST 仅对 Admin 可见。

#### Scenario: 默认不可见
- **WHEN** 发布时未配置任何授权范围
- **THEN** 员工在 Hub 看不到该应用，API 也拒绝员工创建其任务

### Requirement: 导入导出脱敏

应用包 SHALL 支持导出/导入；导出 MUST 去除密钥、私有资源内容与组织内部身份引用；导入后状态为草稿，MUST 重新关联本企业模型/资源并重新审核后才可进入生产。

#### Scenario: 导入包不直接进生产
- **WHEN** Admin 导入一个导出的应用包
- **THEN** 系统生成草稿而非发布版本，且必须重新授权模型、工具与资源并重新审核

### Requirement: 运行时只接受已发布或隔离测试版本

所有运行时 MUST 只接受已发布的 Agent 版本或隔离的 Builder 测试版本；MUST NOT 执行来自员工请求的任意应用定义。

#### Scenario: 伪造应用定义被拒
- **WHEN** 员工通过 API 提交自定义应用定义请求执行
- **THEN** 系统拒绝执行，生产配置不变（AT-06 同语义）

### Requirement: Agent 记录与 slug 生命周期

`agents` 记录 SHALL 随首个草稿创建，slug 全局唯一且在草稿创建时即时校验；同一 Agent 的后续草稿与发布版本挂在该记录下。

#### Scenario: slug 冲突即时报错
- **WHEN** Builder 创建草稿时使用了已存在的 slug
- **THEN** 系统在草稿创建阶段拒绝并提示冲突
