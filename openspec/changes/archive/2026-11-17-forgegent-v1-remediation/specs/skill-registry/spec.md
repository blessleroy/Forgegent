# skill-registry Delta

## MODIFIED Requirements

### Requirement: 投稿待审核

员工 SHALL 可投稿 Skill（SKILL.md 内容及可选脚本/素材/引用文件，或压缩包），投稿内容 MUST 真实落盘持久化；投稿 MUST NOT 等于即时安装、运行或授权（投稿仅进入待审核状态）；任何未审核（非 `published`）Skill MUST NOT 进入生产 ResourceLoader。管理员审核发布时写入生产 Skill 包的内容 MUST 与投稿人提交的内容一致（而非审核请求中由管理员另提供的替换内容）。

#### Scenario: 未审核 Skill 无法被生产加载（AT-09 前半）

- **WHEN** 一个 Skill 处于待审核状态时被生产 Agent 运行时尝试加载
- **THEN** 加载被拒绝，该 Skill 的任何内容不进入模型上下文

#### Scenario: 审核发布后可绑定（AT-09 后半）

- **WHEN** 管理员批准一个投稿 Skill
- **THEN** 该 Skill 以投稿内容落为 `published` 版本（锁定版本与内容哈希），新草稿可绑定

#### Scenario: 发布内容即投稿内容

- **WHEN** 管理员批准一个包含脚本文件的 Skill 投稿
- **THEN** 发布版本包含投稿人提交的脚本文件原文，且内容哈希覆盖全部文件

### Requirement: 管理员审核与撤销

管理员 SHALL 可审核、拒绝、发布、撤销 Skill 版本，审核 MUST 保留审核人与结论；撤销 MUST 记录撤销人（`revoked_by`）与审计事件；撤销仅阻断新草稿绑定，存量 Release 快照按其锁定版本与哈希继续生效（D18）。

#### Scenario: 撤销不熔断存量

- **WHEN** 管理员撤销一个已被某发布版本绑定的 Skill
- **THEN** 新草稿不能再绑定该 Skill；存量 Release 引用的锁定版本继续可用；撤销人与时间在审计中可查

### Requirement: Builder 授权绑定与版本锁定

Builder SHALL 只能从自己获授权的 Skill 列表中选择并绑定到草稿；草稿创建与更新时系统 MUST 校验 `skillRefs` 中每个 Skill 均为 `published` 且该 Builder 拥有绑定授权，校验失败 MUST 拒绝保存并向 Builder 返回可用授权列表（拒绝留痕）；发布时 MUST 锁定具体版本与内容校验值。Admin SHALL 有界面授予/回收 Builder 的 Skill 绑定授权（授权数据已有 API 承载）。

#### Scenario: 无权 Skill 不可绑定

- **WHEN** Builder 在草稿中引用一个未获绑定授权的 Skill 并保存
- **THEN** 保存被拒绝，错误信息附该 Builder 可用的已授权 Skill 列表，拒绝事件留痕

### Requirement: 脚本型 Skill 沙盒强制

系统 MUST 在注册与发布链路检测 Skill 包是否包含脚本/可执行依赖（含可执行文件、安装声明等特征）；含脚本的 Skill 在生产运行时 MUST 被路由到沙盒执行，绑定它的 Agent 的执行模式 MUST 为 `sandboxed`（或发布校验拒绝该组合）；纯指令型（仅 SKILL.md 文稿）Skill 可在 `restricted` Agent 中使用（FR-04.5）。

#### Scenario: 含脚本 Skill 进沙盒

- **WHEN** 一个包含可执行脚本的 Skill 被生产运行时加载
- **THEN** 其脚本仅在沙盒容器内执行；若所在 Agent 为 `restricted` 模式，该脚本内容不可执行

## ADDED Requirements

### Requirement: 生成型 Skill 连带审核

Builder Agent 在草稿中生成的 Skill 草稿（内嵌于 Agent 应用包）SHALL 随 Agent 走单一审核流：Admin 审核 Agent 发布时 MUST 能看到内嵌 Skill 完整内容；批准发布时系统 MUST 将内嵌 Skill 自动落为 `skill_versions`（状态 `published`、提交人为该 Builder、审核人为该 Admin、锁定内容哈希），并进入 Skill 库可供其他草稿绑定。员工独立投稿流保持不变，两条入口汇聚到同一版本与哈希治理机制（D46）。

#### Scenario: 发布即内嵌 Skill 入库

- **WHEN** Admin 批准发布一个内嵌生成型 Skill 的海报 Agent
- **THEN** 该 Skill 以 `published` 版本入库（提交人=Builder、审核人=Admin、哈希锁定），随后其他草稿可按授权绑定它

### Requirement: 生产 Skill 加载接线

生产执行器 MUST 消费发布快照 `payload.skillRefs`：经 skillsOverride 生产 ResourceLoader 只加载快照锁定的 Skill 版本并逐一校验内容哈希（不匹配即结构化失败）；被撤销 Skill 的存量快照按锁定哈希放行（D18）；`restricted` 会话 MUST NOT 因加载 Skill 引入任何未审核内容。

#### Scenario: 绑定 Skill 在运行时生效（AT-09 端到端）

- **WHEN** 员工运行一个绑定了已发布 Skill 的 Agent 任务，任务输入涉及该 Skill 覆盖的场景
- **THEN** 会话记录/任务事件可观测到该 Skill 锁定版本内容已注入模型上下文（如 SKILL.md 内容摘要出现在会话转录）；若快照哈希不匹配，任务以结构化失败告终且不加载任何 Skill 内容
