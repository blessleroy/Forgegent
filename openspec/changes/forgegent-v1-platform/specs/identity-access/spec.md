# identity-access Spec

## Purpose

认证、会话与账号治理：三角色最小授权模型、部门管理、用户生命周期（环境变量初始 Admin、仅停用无删除）与服务端凭证隔离，构成全平台的身份与访问基础。

## ADDED Requirements

### Requirement: 登录与会话管理

系统 SHALL 提供用户名/邮箱 + 密码登录与退出，会话过期后必须重新认证。密码 MUST 以安全哈希存储。Session Cookie MUST 启用 `HttpOnly`、`Secure`（HTTPS 下）、`SameSite`。敏感 API MUST 防 CSRF、限流并防御暴力尝试。

#### Scenario: 会话过期拒绝访问
- **WHEN** 已登录用户的会话过期后访问需认证的 API
- **THEN** 系统返回未认证错误，用户必须重新登录才能继续

#### Scenario: 暴力尝试被限流
- **WHEN** 同一来源在短时间内对登录接口发起多次失败尝试
- **THEN** 系统按限流策略拒绝后续尝试，且不泄露有效账号信息

### Requirement: 三角色最小授权模型

系统 SHALL 支持 `Admin`、`Builder`、`Employee` 三种角色，按人分配，一人可持有多角色；权限计算 MUST 以最小授权为原则——仅授予显式分配的角色能力，`Builder` MUST NOT 继承 `Admin` 权限。角色判定 MUST 在服务端完成，仅靠前端隐藏或数据库角色名字符串 MUST NOT 视为权限边界。

#### Scenario: 员工伪造请求无法越权
- **WHEN** `Employee` 直接调用 API 请求创建 Agent、安装生产 Skill 或发布应用
- **THEN** 服务端返回 403 或同等拒绝，且拒绝事件进入审计日志

#### Scenario: 多角色取显式授权并集
- **WHEN** 同一用户同时持有 `Builder` 与 `Employee` 角色
- **THEN** 系统按其各角色显式授权的并集允许操作，且不因多角色获得任一角色均未授予的能力（`Builder` 不继承 `Admin` 权限）

### Requirement: 用户与部门管理

Admin SHALL 能邀请/创建用户、重置密码、管理部门及成员关系；V1 部门 MUST 由管理员手动维护，不依赖外部组织目录。发布与资源授权 SHALL 支持面向全体员工、具体成员或部门。

#### Scenario: 创建用户并分配角色
- **WHEN** Admin 在用户管理界面创建新用户并分配 `Builder` 角色
- **THEN** 新用户以该角色登录后仅能执行 Builder 授权范围内的操作

### Requirement: 初始 Admin 引导

全新部署 SHALL 通过环境变量指定初始 Admin 账号与密码创建首个管理员。初始密码在首次登录时 MUST 强制修改。

#### Scenario: 首次登录强制改密
- **WHEN** 初始 Admin 使用环境变量密码首次登录
- **THEN** 系统强制要求修改密码后方可使用平台功能

### Requirement: 用户停用生命周期

V1 SHALL 仅支持停用用户，MUST NOT 提供物理删除。用户停用后 MUST 立即被拒绝登录与创建新任务；其进行中任务允许安全完成；其名下 Agent 保持现状且 Admin 可代管；其个人文件与审计记录 MUST 保留且默认不自动清理。

#### Scenario: 停用用户的边界行为
- **WHEN** Admin 停用一个有进行中任务和名下 Agent 的 Builder
- **THEN** 该用户后续登录与新任务创建被拒绝，进行中任务安全完成，其 Agent 由 Admin 可代管，文件与审计记录保留

### Requirement: 凭证与密钥服务端隔离

模型 API Key 与其他生产凭证 MUST 仅存放于服务端受保护配置/秘密存储，MUST NOT 返回浏览器，MUST NOT 直接注入不可信沙盒文件系统；沙盒 MUST 通过受控代理或短期凭证访问模型。

#### Scenario: 凭证不出现在客户端
- **WHEN** 任何用户（含 Admin）通过 Web UI 或 API 查询模型配置
- **THEN** 响应中不包含明文 API Key 或等价凭证材料
