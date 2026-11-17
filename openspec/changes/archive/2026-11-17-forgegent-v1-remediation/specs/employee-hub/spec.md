# employee-hub Delta

## MODIFIED Requirements

### Requirement: 授权过滤的应用清单

Hub MUST 仅展示当前员工被授权（listed + active release + grant 匹配）的已发布 Agent，支持搜索、查看介绍与使用提示、分类筛选；分类 SHALL 由 Admin 在 Agent 管理/发布时指定（草稿可建议 `category`，审核时可修改，N9），未分类应用归入「未分类」区块，分类为非必填。

#### Scenario: 授权过滤生效（AT-04 支撑）

- **WHEN** 员工打开 Hub，存在已发布但未授权给该员工的应用
- **THEN** 清单仅显示授权应用，未授权应用不可见且 API 同样拒绝

#### Scenario: 分类筛选生效

- **WHEN** 员工在 Hub 选择某分类
- **THEN** 清单按该分类过滤；未指定分类的应用出现在「未分类」

### Requirement: Schema 驱动专属任务页

已发布 Agent 的任务页 MUST 按 UI Schema 真实渲染两套模板：`form-result`（表单字段含文本/选择/数字/文件上传/必填校验）与 `document-flow`（资料上传区块 → 大纲确认区块 → 生成进度区块 → 文件下载区块，区块按任务状态驱动显示：`waiting_input` 时呈现消息区与中间产物预览、`running` 时呈现进度、终态呈现下载，D45）；任务初始提交 MUST 支持携带输入文件（API `inputFileIds` 已有，补 UI 入口）。

#### Scenario: 海报应用表单页

- **WHEN** 员工打开 form-result 海报应用
- **THEN** 表单按 Schema 渲染，含文件上传字段与必填校验，提交后创建任务

#### Scenario: 方案应用多阶段页

- **WHEN** 员工打开 document-flow 方案应用并提交客户需求文件
- **THEN** 页面依次呈现资料上传、大纲确认（消息区 + 大纲预览）、生成进度与文件下载区块，各区块与任务状态一致

### Requirement: 成果获取

任务成果 MUST 三途径可达：任务详情页成果区（展示本任务产物并可直接下载）、个人文件空间、在线预览（浏览器可渲染的类型直接预览，其余走下载）；下载 MUST 成功（产物存储统一后不再 500）。

#### Scenario: 成果三途径可达（AT-04 支撑）

- **WHEN** 一个海报任务完成
- **THEN** 员工在任务详情页看到成果区并可下载/预览，同一产物也出现在个人文件空间且可再次下载
