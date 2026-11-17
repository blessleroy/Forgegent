# studio-building Spec

## Purpose

Forgegent Studio 的对话式构建能力：Builder 通过 Builder Agent 对话创建与迭代 Agent 草稿（Prompt、Skill、UI Schema、工具绑定、测试用例），在隔离环境预览测试，并沿草稿状态机提交审核。

## ADDED Requirements

### Requirement: 对话创建 Agent 草稿

Builder SHALL 能通过自然语言对话创建 Agent 草稿；Builder Agent MUST 输出结构化需求清单、待补信息项与拟生成的应用组成，并对关键缺项进行定向提问（关键缺项存在时至少一轮）。

#### Scenario: 对话生成完整草稿（AT-01）
- **WHEN** Builder 输入"创建一个可生成活动海报的 Agent；员工只输入主题和风格，固定使用配置的生图模型，自动应用公司 Logo"
- **THEN** Builder Agent 产出含 Agent Prompt、Skill 草稿、UI Schema、工具绑定声明、资源引用、测试用例与简要使用说明的可验证应用草稿

### Requirement: 对话修改草稿并展示差异

Builder SHALL 能在同一对话中提出修改（如"增加上传附件""改为 9:16""生成 Word"）；修改 MUST 作用于当前草稿并 MUST 展示差异。

#### Scenario: 修改同步草稿与预览（AT-02）
- **WHEN** Builder 对已有草稿提出"增加参考图上传"
- **THEN** 草稿与预览 UI 同步变更并展示差异，且不影响任何已发布版本

### Requirement: 草稿无生产权限

Builder 生成的产物是草稿：MUST NOT 获得生产系统权限，MUST NOT 自行发布；草稿 MUST NOT 提权、直连生产密钥、对外发送企业数据或安装生产 Tool。

#### Scenario: 草稿不能触达生产
- **WHEN** Builder 在草稿中测试运行
- **THEN** 执行仅发生在隔离测试环境，仅能使用经授权的测试资源，无法访问生产凭证与生产资源

### Requirement: 员工视角预览与隔离测试

Builder SHALL 能以最终员工视角预览，使用模拟或经授权的测试资源执行任务；执行报错时错误信息 MUST 完整呈现给 Builder，且修改后的草稿可再次测试。

#### Scenario: 预览运行可迭代
- **WHEN** Builder 在预览环境执行"首次生成—修改文案—重新导出"流程
- **THEN** Builder 看到与员工一致的 UI 与成果；执行报错时错误信息可见且可据此修改草稿

### Requirement: 提审、撤回与复制

Builder SHALL 能提交审核、撤回未处理的申请、复制已有发布版本形成新草稿。任意 Builder SHALL 能复制任意已发布版本，新草稿属主为复制者。

#### Scenario: 复制发布版本成新草稿
- **WHEN** Builder 选择一个已发布 Agent 版本并复制
- **THEN** 系统创建以该 Builder 为属主的新草稿，原发布版本不受影响

### Requirement: 草稿所有权与操作边界

草稿 SHALL 仅由其属主 Builder 编辑、测试与提交审核；Builder 可绑定的模型、Skill 与测试资源 MUST 限定在 Admin 授权范围内。

#### Scenario: 非属主不可操作草稿
- **WHEN** Builder B 尝试编辑或提交 Builder A 的草稿
- **THEN** 系统拒绝该操作并留痕

### Requirement: 草稿状态机

草稿 SHALL 遵循状态机 `editing → in_review →（rejected → editing ｜ approved → 发布）`；同一 Agent 允许并存多个草稿，但同时 MUST 至多一个 `in_review`；审核拒绝退回草稿并保留理由；发布后的修改 MUST 创建新草稿。

#### Scenario: 拒绝退回可再提交
- **WHEN** Admin 拒绝一个提审草稿并附理由
- **THEN** 草稿回到 `editing`、保留拒绝理由，Builder 修改后可再次提审

#### Scenario: 同时仅一个审核中草稿
- **WHEN** 某 Agent 已有一个 `in_review` 草稿，属主尝试提交另一草稿
- **THEN** 系统拒绝提交直至已有审核完成或被撤回

### Requirement: 提审自动测试闸门

草稿提交审核时系统 SHALL 自动运行该草稿的测试用例；测试失败 MUST NOT 阻止提交，但结果 MUST 附给审核者作为审核材料。

#### Scenario: 失败可提交但审核可见
- **WHEN** Builder 提交一个自动测试未全部通过的草稿
- **THEN** 提交成功进入 in_review，审核者在审核界面可见测试失败明细

### Requirement: Studio 访问角色门槛

无 `Builder` 角色的用户访问 Studio 页面与相关 API MUST 均被拒绝（AT-17）。

#### Scenario: 页面与 API 双拒绝（AT-17）
- **WHEN** 仅持 `Employee` 角色的用户访问 `/studio` 页面或调用 Studio API
- **THEN** 页面与 API 均拒绝访问并留痕

### Requirement: 测试运行隔离可见性

Builder 预览测试产生的任务 MUST 标记来源为测试，且 MUST NOT 出现在员工任务列表中，仅在 Studio 草稿上下文内可见。

#### Scenario: 测试任务不进员工列表
- **WHEN** Builder 在预览环境执行测试任务后查看自己的 `/tasks` 页面
- **THEN** 该测试任务不出现在员工任务列表，仅在 Studio 草稿详情中可见

### Requirement: V1 生成物形态

V1 生成物 SHALL 以既有 UI 模板 + Schema 生成为主；复杂自定义 React 页面生成属于 P1，不在本能力范围内。

#### Scenario: Schema 驱动生成
- **WHEN** Builder Agent 生成员工界面
- **THEN** 产物为受控 UI Schema（配合平台模板），而非自由代码
