# skill-registry Spec

## Purpose

Skill 注册与治理：Skill 版本与内容完整性、员工投稿待审核制、管理员审核发布撤销、Builder 授权绑定与版本锁定，以及"未审核 Skill 不得进入生产 ResourceLoader"的硬约束。

## ADDED Requirements

### Requirement: Skill 构成与版本完整性

Skill 由 `SKILL.md` 与可选脚本/素材/引用文件组成；注册表 MUST 存储每个版本及其内容哈希。

#### Scenario: 版本可校验
- **WHEN** 任一 Skill 版本被绑定或加载
- **THEN** 系统能以存储的哈希校验其内容完整性

### Requirement: 投稿待审核

员工 SHALL 可提交 Skill 说明或压缩包投稿，投稿后状态为待审核；任何未审核 Skill MUST NOT 进入生产 ResourceLoader；投稿 MUST NOT 等于即时安装、运行或授权。

#### Scenario: 未审核 Skill 无法被生产加载（AT-09 前半）
- **WHEN** 一个 Skill 投稿尚未通过审核
- **THEN** 生产 Agent 无法加载它，相关绑定请求被拒绝

#### Scenario: 审核发布后可绑定（AT-09 后半）
- **WHEN** Admin 审核通过并发布该 Skill 新版本
- **THEN** 新的 Agent 草稿可以绑定该版本

### Requirement: 管理员审核与撤销

Admin SHALL 能审核、拒绝、发布、撤销 Skill；审核记录 MUST 保留审核人与结论。撤销已发布版本 MUST 仅阻断新草稿绑定该版本，存量 Agent Release 不受影响；紧急下线走 Agent 下架。

#### Scenario: 撤销不熔断存量
- **WHEN** Admin 撤销一个已被多个发布版本引用的 Skill 版本
- **THEN** 已引用它的发布版本照常运行，仅新草稿无法再绑定该版本

### Requirement: Builder 授权绑定与版本锁定

Builder SHALL 只能从自己获授权的 Skill 列表中选择并绑定到草稿；发布时 MUST 锁定具体版本与校验值。

#### Scenario: 无权 Skill 不可绑定
- **WHEN** Builder 尝试绑定一个未对其授权的 Skill
- **THEN** 系统拒绝绑定并留痕

### Requirement: Builder Skill 绑定授权

Admin SHALL 能按 Builder 授予/收回 Skill 绑定权（绑定权独立于 Skill 的发布状态）；Builder 的可绑定列表 MUST 仅含已发布且对其授权的 Skill 版本。

#### Scenario: Admin 授予绑定权
- **WHEN** Admin 为 Builder X 授予 Skill S 的绑定权后，X 编辑草稿
- **THEN** X 的可绑定列表出现 S；未获授权的 Builder 列表中不出现 S

### Requirement: 脚本型 Skill 沙盒强制

无脚本的指令型 Skill SHALL 可在受限工具 Agent 中使用；包含脚本/依赖/扩展的 Skill MUST 走沙盒执行并接受更严格的安全检查。

#### Scenario: 含脚本 Skill 进沙盒
- **WHEN** 一个含可执行脚本的 Skill 被用于业务 Agent
- **THEN** 其脚本仅在沙盒环境执行，宿主机不可触及
