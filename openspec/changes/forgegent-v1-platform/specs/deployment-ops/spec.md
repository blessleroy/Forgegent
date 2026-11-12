# deployment-ops Spec

## Purpose

部署与运维交付形态：Docker Compose 单机自部署（无 Redis/S3/MQ）、环境变量初始 Admin、seed 示例闭环（演示账号 + 已发布示例海报 Agent）、性能与隔离验收基线。

## ADDED Requirements

### Requirement: Docker Compose 单机部署

全新服务器 SHALL 能按 README 以 Docker Compose 部署运行，默认仅依赖 Web 进程、Runner 进程、SQLite、本地数据卷与按需沙盒容器；MUST NOT 需要 Redis、S3/MinIO、消息队列或 Kubernetes。

#### Scenario: 全新服务器可部署（AT-20 前半）
- **WHEN** 在全新 Linux 服务器上按 README 执行 Docker Compose 部署
- **THEN** 系统启动成功且不要求任何被禁入的基础设施组件

### Requirement: 初始 Admin 环境变量

部署配置 SHALL 通过环境变量提供初始 Admin 账号与密码；该账号首登 MUST 强制改密。

#### Scenario: 部署后可登录治理
- **WHEN** Compose 部署完成并以环境变量 Admin 首次登录
- **THEN** 强制改密后 Admin 可进入管理界面完成模型端点等配置

### Requirement: seed 示例闭环

部署 SHALL 提供 seed 脚本：预置 Builder/Employee 演示账号与一个已发布状态的示例海报 Agent；README SHALL 引导 Admin 配置模型端点（OpenAI 兼容对话 + images 生图）后即可运行示例闭环。

#### Scenario: 开箱示例闭环（AT-20 后半）
- **WHEN** 部署 + 配置模型端点 + 执行 seed 后，演示 Employee 打开示例海报应用
- **THEN** 员工可输入主题生成、预览并下载海报，完成示例闭环

### Requirement: 性能与可用性基线

V1 验收基线 MUST 为：支持 5 个并发运行任务（上限可配置），用户任务/会话/文件严格隔离；核心接口 MUST 记录 P50/P95（不将 LLM 等待计入 Web 慢）；沙盒 MUST 预装镜像、无每任务拉镜像；同一会话连续修改 MUST 复用沙盒。

#### Scenario: 并发隔离达标（AT-07）
- **WHEN** 5 个任务并发运行
- **THEN** 全部完成且相互隔离，无串数据或串会话

### Requirement: 备份恢复操作说明

项目 SHALL 提供数据库与文件系统的备份/恢复说明，保证备份可获得一致性数据快照（AT-19 支撑）。

#### Scenario: 按说明恢复成功
- **WHEN** 运维按说明备份生产数据并恢复到测试环境
- **THEN** 账号、发布版本、文件元数据与文件内容与源环境一致
