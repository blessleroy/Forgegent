# Proposal

## Why

企业需要"由少数授权人员用自然语言构建 Agent 应用、由多数普通员工像使用 Web 软件一样使用已发布应用"的平台（产品契约见 PRD §1.1）。现有形态（全员可建的聊天机器人平台、节点式工作流编辑器）要么放弃治理与安全边界，要么放弃 Agent 自主规划能力。本项目为绿地开发，从零交付可自行部署、单企业实例、开源友好（Apache-2.0）的 V1 平台，验收基线为 PRD AT-01~AT-20 与 DoD（§14）。

## What Changes

- 新建完整平台（绿地）：Forgegent Studio（Builder 对话构建）、Forgegent Hub（员工应用中心与专属任务 UI）、Control Plane（审核发布/资源/用户/审计治理）、Agent Runtime（基于 `@earendil-works/pi-coding-agent` SDK 的独立 Runner）
- 建立 Agent 应用包治理链：草稿 → 审核 → 不可变发布快照 → 授权使用 → 版本回滚；导入/导出脱敏
- 建立 Skill 投稿审核制：未审核 Skill 不得进入生产 ResourceLoader
- 建立 restricted / sandboxed 双运行模式（Docker Rootless 按会话容器）
- 建立权限交集模型（用户 ∩ Agent Release ∩ Task，默认拒绝）与 Tool Gateway 逐调用校验
- 建立任务生命周期（后台执行、SSE 进度、消息式继续交互、取消、中断恢复）与个人文件空间
- 平台 UI 双语 i18n（中/英，超出原 PRD 的用户决策）；模型接入走自部署/中转 OpenAI 兼容端点（含 images 生图 API）
- 单机 Docker Compose 部署：仅 Web 进程 + Runner 进程 + SQLite + 本地文件卷 + 按需沙盒容器；无 Redis/MQ/S3/K8s
- 明确不做（PRD §1.3）：全员建 Agent、通用聊天首页、可视化工作流编辑器、SaaS 多租户、Office 级编辑器、任意指令级崩溃恢复

## Capabilities

### New Capabilities

- `identity-access`: 认证、会话、三角色（Admin/Builder/Employee）与最小授权、部门、用户生命周期（环境变量初始 Admin、仅停用无删除）、凭证与密钥服务端隔离
- `studio-building`: Builder 通过 Builder Agent 对话创建/迭代 Agent 草稿（Prompt/Skill/UI Schema/工具绑定/测试用例）、员工视角预览与隔离测试、草稿状态机与提审
- `agent-registry`: Agent 应用包规范（manifest 等）、草稿→审核→不可变发布快照、上下架/回滚/导入导出脱敏、发布范围授权、复制发布版本成新草稿
- `skill-registry`: Skill 版本与内容哈希、员工投稿、管理员审核发布撤销、Builder 授权绑定与版本锁定、未审核不进生产 ResourceLoader
- `resource-governance`: 模型 provider（OpenAI 兼容自部署端点）、企业资料与 HTTP API 工具的声明式配置、Admin 授予 ACL、资源检索先过滤后返回、不可信内容不提升权限
- `task-execution`: 任务创建绑定 Release 快照、状态机（pending…interrupted 八态）、SSE 脱敏推送与断线补读、消息式 continue/cancel、SQLite 任务表 + 单 Runner 租约、崩溃标记 interrupted、幂等与预算
- `sandbox-isolation`: restricted 白名单工具模式与 sandboxed Docker Rootless 容器模式、非特权最小权限约束、按会话生命周期与回收清理、严禁 Docker Socket/生产密钥/宿主敏感路径挂载
- `permission-enforcement`: 有效权限 = 用户 ∩ Agent Release ∩ Task、默认拒绝、Tool Gateway 逐调用校验（用户/Agent/Task/动作/资源/参数）、提示词注入不授新权、拒绝留痕
- `personal-files`: 员工个人文件空间（上传/下载/删除/配额）、任务产物写回、输入引用关联、路径穿越/符号链接/可猜测 ID 防护、本机目录 + SQLite 元数据
- `employee-hub`: Hub 应用清单（授权过滤/搜索/分类）、Schema 驱动专属任务页（form-result 与 document-flow 双模板）、平台 UI 双语 i18n、员工无配置修改入口
- `audit-observability`: 审计日志（发布/审核/拒绝/敏感操作，不含秘密值）、usage 记录（Token/成本）、结构化 JSON 日志脱敏
- `deployment-ops`: Docker Compose 单机部署、环境变量初始 Admin（首登强制改密）、seed 示例闭环（演示账号 + 已发布示例海报 Agent）、SQLite+文件一致性备份恢复说明

### Modified Capabilities

（无——绿地项目，`openspec/specs/` 当前为空）

## Impact

- **代码**：全部新建。建议形态为单仓库：Next.js Web（含 API/Auth/Permission Manager）+ 独立 Node.js Runner 进程 + 共享 TS 包；技术栈已锁定（PRD §7 + D2-D11）
- **API**：`/api/v1` 下按 PRD §10 契约落地（任务 continue 扩展支持运行中消息提交，D27）
- **外部依赖**：`@earendil-works/pi-coding-agent` SDK（版本锁定，注意 scope 迁移历史）、Better Auth、Drizzle、Docker Rootless；生图走管理员配置的 OpenAI 兼容 images 端点
- **部署**：目标 Linux 单机（Ubuntu 22.04+/Debian 12）；开发期 macOS Docker Desktop 等价验证，最终验收在 Linux
- **交付顺序**：M0 骨架 → M1 业务闭环 → M2 Studio 闭环 → M3 资源治理（PRD §13）；P1 增强不在本 change 范围
- **决策溯源**：本 change 需求分三档（详见 `openspec/le-spec/state.md`）：用户确认（PRD 基线 D1–D8、访谈 D9–D16 与 D27）｜推导默许（D17–D26）｜非阻塞默认（N1–N7）；specs 中相关条目按此标注，后续变更优先级应据此分档
