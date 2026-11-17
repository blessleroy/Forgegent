# identity-access Specification

## Purpose
认证、会话与账号治理：三角色最小授权模型、部门管理、用户生命周期（环境变量初始 Admin、仅停用无删除）与服务端凭证隔离，构成全平台的身份与访问基础。

## Requirements

### Requirement: 登录与会话管理

平台 SHALL 提供登录/退出与会话过期；密码 MUST 以安全哈希存储；登录端点 MUST 限流防暴力；所有变更类 API（写操作）MUST 经过 CSRF Origin 校验（服务端 Origin/可信源检查，覆盖全部变更路由而非个别路由），会话 Cookie 保持 HttpOnly/Secure(HTTPS)/SameSite 属性。

#### Scenario: 会话过期拒绝访问

- **WHEN** 一个过期会话请求受保护 API
- **THEN** 请求被拒绝且要求重新登录

#### Scenario: 暴力尝试被限流

- **WHEN** 同一来源短时间多次失败登录
- **THEN** 后续尝试被限流拒绝

#### Scenario: 跨站伪造变更请求被拒

- **WHEN** 已登录用户的浏览器被恶意页面诱导向任一变更 API（任务创建、文件上传、草稿操作等）发送跨站请求
- **THEN** 服务端 Origin 校验拒绝该请求，状态不发生变更

### Requirement: 三角色最小授权模型

系统 SHALL 支持 `Admin`、`Builder`、`Employee` 三种角色，按人分配，一人可持有多角色；权限计算 MUST 以最小授权为原则——仅授予显式分配的角色能力，`Builder` MUST NOT 继承 `Admin` 权限。角色判定 MUST 在服务端完成，仅靠前端隐藏或数据库角色名字符串 MUST NOT 视为权限边界。

#### Scenario: 员工伪造请求无法越权
- **WHEN** `Employee` 直接调用 API 请求创建 Agent、安装生产 Skill 或发布应用
- **THEN** 服务端返回 403 或同等拒绝，且拒绝事件进入审计日志

#### Scenario: 多角色取显式授权并集
- **WHEN** 同一用户同时持有 `Builder` 与 `Employee` 角色
- **THEN** 系统按其各角色显式授权的并集允许操作，且不因多角色获得任一角色均未授予的能力（`Builder` 不继承 `Admin` 权限）

### Requirement: 用户与部门管理

管理员 SHALL 能创建用户（指定初始密码并强制首登改密）、分配角色与部门（部门由管理员手动维护，MUST NOT 依赖外部组织目录）、重置密码；重置密码的完整语义为：Admin 设置临时密码（线下交付，V1 无邮件通道）、置 `must_change_password`、并吊销该用户全部既有会话（D43）；重置流程 MUST NOT 使账号进入无凭证可用状态（旧凭证删除与新凭证写入在原子流程内完成）。

#### Scenario: 创建用户并分配角色

- **WHEN** Admin 在用户管理界面创建新用户并分配 `Builder` 角色
- **THEN** 新用户以该角色登录后仅能执行 Builder 授权范围内的操作

#### Scenario: 重置密码后旧会话失效

- **WHEN** Admin 为用户 U 重置密码
- **THEN** U 的全部既有会话立即失效（旧 Cookie 不可再用），U 以临时密码登录后被强制修改密码；重置过程中账号不存在"旧凭证已删、新凭证未建"的锁死窗口

### Requirement: 初始 Admin 引导

环境变量初始 Admin MUST 在首次登录后强制修改密码；强制 MUST 在服务端落实：`must_change_password` 未清除前，除改密端点外的全部 API 被守卫拒绝（前端跳转仅为体验，非强制点）。

#### Scenario: 首次登录强制改密

- **WHEN** 初始 Admin 使用环境变量密码首次登录后，未修改初始密码而直接调用任一管理 API
- **THEN** 请求被服务端拒绝并要求先完成改密（仅改密端点可用）；完成改密后方可使用平台功能

### Requirement: 用户停用生命周期

停用用户 MUST 在认证层被拒绝登录（不发放新会话）；停用操作 MUST 同时吊销该用户全部既有会话；已停用用户 MUST 被拒绝创建新任务，其运行中任务按既定策略安全完成；名下 Agent 冻结现状、Admin 可代管；文件与审计保留（D22）。V1 仅停用、MUST NOT 提供物理删除。

#### Scenario: 停用用户的边界行为

- **WHEN** 管理员停用用户 U（U 此前已登录且有一个运行中任务）
- **THEN** U 的既有会话立即失效且无法重新登录；U 的运行中任务安全完成至终态；U 的文件与审计记录保留可查

### Requirement: 凭证与密钥服务端隔离

模型 API Key 与其他生产凭证 MUST 仅存放于服务端受保护配置/秘密存储，MUST NOT 返回浏览器，MUST NOT 直接注入不可信沙盒文件系统；沙盒 MUST 通过受控代理或短期凭证访问模型。

#### Scenario: 凭证不出现在客户端
- **WHEN** 任何用户（含 Admin）通过 Web UI 或 API 查询模型配置
- **THEN** 响应中不包含明文 API Key 或等价凭证材料
