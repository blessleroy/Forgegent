# employee-hub Spec

## Purpose

员工侧 Forgegent Hub：授权过滤的应用清单、Schema 驱动的专属任务页（form-result 与 document-flow 双模板）、消息式继续交互区、成果获取，以及平台 UI 双语 i18n 与"员工无配置入口"的边界。

## ADDED Requirements

### Requirement: 授权过滤的应用清单

员工进入 Hub SHALL 看到应用清单（而非空白聊天框）：仅展示被授权 Agent，支持搜索、分类（Admin 管理的固定目录）与查看介绍、使用提示。

#### Scenario: 授权过滤生效（AT-04 支撑）
- **WHEN** Admin 发布海报 Agent 并授权某员工
- **THEN** 该员工 Hub 可见海报应用，未授权员工不可见

### Requirement: Schema 驱动专属任务页

点击应用 SHALL 进入其定义的专属任务页，由 UI Schema 渲染：输入字段、文件上传、参数、执行按钮、状态、成果与修改入口。V1 SHALL 提供两种模板：`form-result`（表单 + 结果预览 + 下载，海报类）与 `document-flow`（资料上传 → 大纲确认 → 生成进度 → 文件下载，方案类）。Schema 能力 SHALL 覆盖文本/选择/数字/文件上传字段、必填校验与布局区块。

#### Scenario: 海报应用表单页
- **WHEN** 员工打开海报设计师应用
- **THEN** 页面呈现主题与风格输入字段及执行按钮，而非聊天界面

#### Scenario: 方案应用多阶段页
- **WHEN** 员工打开方案生成专家应用
- **THEN** 页面按 document-flow 模板呈现资料上传、大纲确认、进度与下载区块

### Requirement: 员工无配置修改入口

员工 MUST NOT 能修改模型提供商、系统 Prompt、Skills、Tools、数据源或执行策略——无论通过 UI 还是伪造请求。

#### Scenario: 无任何配置入口
- **WHEN** 员工浏览任意任务页与 Hub 页面
- **THEN** 不存在模型/Skill/Tool/数据源/执行策略的修改入口，直接 API 修改亦被拒

### Requirement: 消息式继续交互区

任务页 SHALL 在初始表单之外提供局部消息交互区：`waiting_input` 时呈现 Agent 请求消息（可附阶段产物预览），终态后支持自由文本继续修改；平台整体 MUST 保持"应用清单 + 专属任务页"形态，MUST NOT 演变为通用聊天首页。

#### Scenario: 任务页内局部消息流
- **WHEN** 任务处于 `waiting_input` 或已到终态
- **THEN** 员工在任务页消息区以文本交互，页面其余部分仍为该应用的 Schema 表单与产物区

### Requirement: 任务上下文延续

员工 SHALL 能在自己已有任务上继续修改，保持任务关联的上下文与文件。

#### Scenario: 继续修改沿用上下文（AT-13 支撑）
- **WHEN** 员工对已完成的海报任务提出文案修改
- **THEN** 系统在同一任务与工作会话内继续，无需重复输入先前需求

### Requirement: 成果获取

任务结果文件 SHALL 可下载；图片与文本类成果 MUST 支持在线预览；所有成果 MUST 可在个人文件空间查找。

#### Scenario: 成果三途径可达（AT-04 支撑）
- **WHEN** 海报任务完成
- **THEN** 员工可在任务页预览与下载图片，并能在个人文件空间找到该成果

### Requirement: 平台 UI 双语 i18n

平台 UI（登录、Hub、Studio、Admin）SHALL 提供中文/英文双语；Agent 应用内容（名称、描述、UI Schema 文案）的语言由 Builder 定义，V1 不强制双语。

#### Scenario: 切换界面语言
- **WHEN** 用户在界面上切换语言偏好
- **THEN** 平台 UI 文案整体切换，Agent 应用内容保持 Builder 定义的语言不变
