# Le SPEC 状态 — Forgegent（智体工坊）V1
更新: 2026-11-14 | 阶段: 已交接（实现完成, verify 通过并修复, UI 迭代 v1） | 复杂度: complex（全新产品、Admin/Builder/Employee 三角色、构建→审核→发布→运行多流程、沙盒隔离、外部 SDK 集成）

## 交接后实施记录
- 52/52 任务完成（M0-M3 + 收尾, 2026-11-13）
- openspec-verify-change 核验: 3 CRITICAL + 10 WARNING → 全部修复（C1 用户管理 API / C2 usage_records / C3 可观测字段 / W1-W9 测试补强）, 复验 0 CRITICAL
- UI 重塑（用户反馈"太简陋无入口"）: 锻造工坊设计系统 + AppShell 导航壳 + 全部页面精修 + /files + /change-password（frontend-design skill 指导, 容器实测零错误）
- 测试 148/148, build 零错误, AT-20 容器冒烟通过
- 遗留（不阻塞归档）: W7 脚本型 Skill 沙盒路由 / W10 共享资料显式写拒绝 / Builder Agent LLM 后端（现为启发式, 接口就绪待模型端点）

## 项目
类型: 全新（绿地，仅 PRD/README/LICENSE，无代码） ｜ 目标: 可自行部署、开源友好的单企业实例 Agent 应用构建与发布平台（依据: Forgegent_V1_AI_PRD.md）

## 原始输入摘要
- (来源: Forgegent_V1_AI_PRD.md 全文 465 行) 完整 PRD：产品定义/角色/旅程/页面/FR-01~FR-10/应用包规范/架构/数据模型/API 契约/非功能/AT-01~AT-22/M0-M3/DoD/默认决策表
- (来源: 用户首条消息) "根据 PRD 进行开发" —— 意图为按 PRD 实施；le-spec 流程：先访谈收敛开放项 → SPEC → 用户批准 → 交接编码

## Phase 1 十类分拣
1. **明确需求**: Studio/Hub/Control Plane/Runtime 四组件; FR-01~FR-10; 页面清单 §4; 应用包规范 §6; 数据模型 §9; API 契约 §10; AT-01~AT-22 §12; M0-M3 §13
2. **目标与期望结果**: 单企业可部署、Docker Compose 单机、开源条件发布; DoD 8 条（§14）
3. **角色与场景**: Admin/Builder/Employee（§2 权限矩阵）; 三个旅程: 海报设计师、方案生成专家、Skill 投稿（§3）
4. **未定想法**: [未定] 本次交付范围（V1 全量 M0-M3 还是先 M0/M1）; [未定] /api/v1 版本化为"建议"落地; PRD 明示技术细节属建议实现、可调整（除"必须"项）
5. **用户假设**: pi-coding-agent SDK 可用 → **已核实为真**: npm `@earendil-works/pi-coding-agent`（MIT, earendil-works/pi, createAgentSession/DefaultResourceLoader/customTools/tools 白名单均存在; 包曾迁移 scope，旧教程指向废弃包）; Docker Rootless 在目标环境可用（未验证, 开放问题）; Better Auth 满足 V1 认证（PRD 推荐）
6. **约束**: 禁入 Redis/MQ/S3/Keycloak/K8s/向量库/工作流引擎; SQLite WAL + Drizzle; Next.js + TS 单体 + 独立 Runner 进程; 安全边界服务端落实; 锁定依赖版本; Apache-2.0
7. **矛盾描述**: PRD 内部未发现硬矛盾（自洽性高）。轻微张力: FR-06.7 "单进程 Runner" vs §7 架构图 Runner 含沙盒容器——实为 Runner 进程 + 按需容器, 一致
8. **重要缺失信息**: 本次开发范围; 目标部署/开发环境; 模型 provider 与 key 来源; UI 界面语言; OpenSpec 根初始化授权
9. **已否定方案**: 见"已否定方案"节（全部来自 PRD 原文, 视为用户已定）
10. **明确不做**: §1.3 全部非目标 + §7 "明确不需要"清单

## 已确认决策
| # | 决策 | 内容 | 来源 | 状态 |
|---|------|------|------|------|
| D1 | 产品契约 | 少数授权者用 Agent 造应用, 多数员工像用 Web 软件一样用已发布应用 | PRD §1.1 | 已确认（PRD 基线） |
| D2 | 技术栈 | Next.js+React+Tailwind/shadcn, Node/TS, @earendil-works/pi-coding-agent SDK, SQLite+Drizzle, Better Auth, Docker Rootless, SSE | PRD §7 | 已确认（PRD 基线, 版本待锁定） |
| D3 | 禁入基础设施 | 无 Redis/MQ/S3/Keycloak/K8s/向量库/工作流引擎; 单机 Docker Compose | PRD §0.2/§7 | 已确认（PRD 基线） |
| D4 | 运行双模式 | restricted（白名单工具, 常驻 Runner）+ sandboxed（Docker Rootless 按会话容器, 空闲 15min 回收） | PRD §5.8 | 已确认（PRD 基线） |
| D5 | 权限模型 | 有效权限 = 用户 ∩ Agent 发布版本 ∩ 任务, 默认拒绝, Tool Gateway 逐调用校验 | PRD §5.9 | 已确认（PRD 基线） |
| D6 | 发布不可变 | 发布产物为不可变快照, 任务绑定 release, 回滚切指针 | PRD §5.2/§8.1 | 已确认（PRD 基线） |
| D7 | V1 UI 方式 | Schema 驱动 UI + 既有模板; 自定义 React 页面为 P1 | PRD §5.1.7/§6 | 已确认（PRD 基线） |
| D8 | 交付切片 | M0 骨架 → M1 业务闭环 → M2 Studio 闭环 → M3 资源治理 → P1 | PRD §13 | 已确认（PRD 基线） |
| D9 | SPEC 范围 | V1 全量（M0-M3 全部 P0 + AT-01~AT-20），tasks 按里程碑分片 | 用户 Q1=A | 已确认 |
| D10 | 部署环境 | 目标 = Linux 单机（Ubuntu 22.04+/Debian 12 + Rootless Docker）；开发期 macOS Docker Desktop 等价验证；最终验收在 Linux | 用户 Q2=A | 已确认 |
| D11 | 模型接入 | 兼容自部署/中转 OpenAI 兼容端点（custom base URL），管理员服务端配置；Pi ModelRuntime 支持自定义端点 | 用户 Q3=C | 已确认 |
| D12 | UI 语言 | 双语 i18n（中/英）V1 就做 —— **范围扩大于 PRD**（PRD 无 i18n 要求, 原 PRD 全中文） | 用户 Q4=C | 已确认（衍生 Q7 待定范围） |
| D13 | OpenSpec 根 | 仓库根 `openspec init --tools none`，SPEC 与状态进版本库 | 用户 Q5=A | 已确认 |
| D14 | 初始 Admin | 环境变量指定初始账号密码；[默认] 首次登录强制修改初始密码（依据: 环境变量密码有落盘风险, PRD §5.10 安全要求） | 用户 Q6=B | 已确认 |
| D15 | i18n 范围 | 仅平台 UI（登录/Hub/Studio/Admin）双语中/英；Agent 应用内容（名称/描述/UI Schema 文案）由 Builder 定义语言, 不强制双语; Schema 可后续加可选双语字段（向后兼容） | 用户 Q7=A | 已确认 |
| D16 | 生图能力 | 用户自部署/中转端点支持 OpenAI 兼容 images API; 海报 Tool 按 OpenAI 兼容 images 端点实现, base URL+key 由管理员服务端配置 | 用户 Q8=A | 已确认 |

## Phase 4 推导决策（major 处置, 2026-11-12, 独立子代理审查产出 → 按已确认决策推导）
| # | 决策 | 推导依据 | 状态 |
|---|------|------|------|
| D17 | 任务 continue 语义: continue 复用同一 task 记录与 session, 状态回 running; completed/failed/interrupted/cancelled 均可 continue（failed=修复输入后续跑; cancelled=续跑被取消会话）; 每次 continue 是同 task 新 run, /tasks 保持单条记录滚动更新 | FR-03.4 + AT-13 + §8.3 | [推导] 用户默许 |
| D18 | Skill 撤销/资源回收 vs 不可变: 存量 Release 不受影响, 撤销仅阻断新草稿绑定; 紧急止血走 Agent 下架（运行中任务默认安全完成）; V1 无运行时 kill-switch | D6 + FR-02.2 + §8.1 | [推导] 用户默许 |
| D19 | Builder 有权范围: 草稿仅属主可编辑/提交/测试; 任意 Builder 可复制任意已发布版本生成新草稿（owner=复制者）; Builder 可绑定模型/Skill/测试资源 = Admin 授权范围 | §10 "Builder/拥有者" + FR-01.6 + FR-05.2 | [推导] 用户默许 |
| D20 | 草稿状态机: editing → in_review → (rejected → editing ｜ approved → 发布); 同 Agent 允许多草稿、同时最多一个 in_review; agents 行随首个草稿创建, slug 唯一性即时校验 | §8.1 + §9 | [推导] 用户默许 |
| D21 | 资源可见范围控制权: 员工资源 ACL 由 Admin 授予; Builder 向导设定的是 Release 级应用收窄; 生效范围 = 员工 ACL ∩ 应用声明 | §2 + FR-05.2/05.3 + AT-10 | [推导] 用户默许 |
| D22 | 用户停用: V1 仅停用无物理删除; 停用即拒登录/拒新任务, 运行中任务安全完成; 名下 Agent 冻结现状、Admin 可代管; 文件与审计保留 [默认] 不自动清理 | §2 Admin 全权 + §8.1 下架同构 + §11.1 审计要求 | [推导] 用户默许 |
| D23 | files 关联: files.task_id 仅记产出任务; 输入引用独立关联表 task_file_refs; 被运行中任务引用的文件删除时阻止并提示（软删除） | FR-07.1/07.3 + §8.2 | [推导] 用户默许 |
| D24 | V1 UI 模板集: ① form-result（海报: 表单+结果预览+下载）② document-flow（方案: 资料上传→大纲确认→生成进度→文件下载）; Schema 能力集（文本/选择/数字/文件上传/必填校验/布局区块）写入 SPEC | DoD#2 + §3.1/3.2 + §6 | [推导] 用户默许 |
| D25 | AT-20 示例闭环 = Compose 部署 + 环境变量初始 Admin + seed 脚本（预置 Builder/Employee 演示账号 + 一个已发布示例海报 Agent）+ README 引导配置模型端点后员工可生成海报 | AT-20 字面 + D11/D14 + M1 时序（Studio 未成, 必须预置） | [推导] 用户默许 |
| D26 | HTTP API 工具: 声明式配置（端点/方法/参数 JSON Schema/鉴权类型）+ 凭证仅存服务端 + 经 Tool Gateway 代理执行 + 出网白名单随 Release 绑定 | FR-05.2 + FR-09.2/09.3 + §11.1 | [推导] 用户默许 |
| D27 | waiting_input 交互闭环（用户裁决 B）: 运行中回复与终态后继续修改**统一走消息流**——任务页在 UI Schema 初始表单之外提供局部消息交互区; Agent 需要输入时任务进入 waiting_input, 以 Agent 消息呈现请求（可附阶段产物卡片/预览）, 员工自由文本回复（continue 端点扩展支持运行中提交）; 不做结构化确认卡、不加专用 input 端点; 中间产物（大纲/海报草稿）经 SSE 事件在任务页产物区展示。约束不变: 员工消息不能修改模型/工具/资源（服务端校验）; Hub 仍是应用清单、初始输入仍是表单, 平台整体不是聊天首页 | 用户 Q9=B（知悉与 §0.3 的张力并接受消息式任务页形态） | 已确认 |

## 非阻塞事项（minor, 随 SPEC"非阻塞事项"呈现）
- N1 发布范围默认: 未显式授权 = 无人可见（仅 Admin）[默认, 安全默认]
- N2 Hub 分类: Admin 管理的固定目录 [默认]
- N3 部门模型: 新增 departments + user_departments 表, 授权判定实时计算 [默认, 推导]
- N4 Studio 对话持久化（新增表）; Builder 测试运行入 tasks 标 origin=test, 仅 Studio 可见不进员工 /tasks [默认, 推导]
- N5 自动测试闸门: 提审时运行, 失败仍可提交但结果附给审核者 [默认]
- N6 超时/超预算 → failed + 结构化原因, 可 continue 或新建任务重试 [默认]
- N7 任务/文件共享 V1 不做, API 权限中"授权者"仅指 Admin; 应用包导入/导出入口补进 /admin/agents [默认, 推导]

## 已否定方案
- 员工全员可建 Agent / 通用聊天首页 — 与产品契约冲突（PRD §1.3）
- Dify/Coze 式节点工作流编辑器 — Agent-first 原则否定（PRD §1.2/§1.3）
- SaaS 多租户/跨企业共享 — V1 单企业实例（PRD §1.2）
- NestJS 微服务 + Redis/MQ/S3/K8s 全家桶 — 违反简单可部署（PRD §7）
- 进程崩溃后任意指令级精确恢复 — 承诺过高, 只做持久化上下文恢复（PRD §1.3）
- V1 内置所有外部连接器 — 改为管理员配置的文件/HTTP API（PRD §1.3）
- 仅靠 Prompt/前端隐藏做安全 — 必须服务端+执行端落实（PRD §0.4）

## 开放问题
- [x] ~~Q1 范围~~ → D9 ｜ ~~Q2 环境~~ → D10 ｜ ~~Q3 模型~~ → D11 ｜ ~~Q4 语言~~ → D12 ｜ ~~Q5 OpenSpec~~ → D13 ｜ ~~Q6 初始 Admin~~ → D14（第一轮 2026-11-12 全部关闭）
- [x] ~~Q7 i18n 范围~~ → D15 ｜ ~~Q8 生图能力~~ → D16（第二轮 2026-11-12 关闭）
- [x] ~~Q9 waiting_input 闭环~~ → D27（用户 2026-11-12 裁决 B; blocking 清零）

## Phase 4 收口
- blocking 1（Q9→D27）｜ major 10（→D17-D26, 用户默许）｜ minor 7（→N1-N7 非阻塞）｜ 2026-11-12 清零, 允许进入 Phase 5

## 假设（待验证）
- Docker Rootless 满足 V1 沙盒隔离要求（PRD 自己也标注"Rootless 不是强隔离的充分条件", 以 FR-08 清单为准）
- Better Auth 与 Next.js App Router + SQLite 集成顺畅（实现期验证）
- @earendil-works/pi-coding-agent 的 DefaultResourceLoader 可注入平台审核后的 Skills（SDK 文档确认 skillsOverride 存在, 实现期验证细节）

## 访谈计数
轮次: 2 ｜ 检查点: 2026-11-12 轮 2 后——已确认 16 项 / 开放 0 项 / 收敛判断: **已达标**（目标✅ 范围✅ 角色✅ 流程闭环✅ 业务规则✅ 数据与权限边界✅ 异常原则✅ 无重大未决✅）

## Phase 3 预判
- **已跳过（2026-11-12, 用户确认共识时无异议）**: 理由——无实质方案分歧; PRD §7/§15 即完整技术方案（架构/选型/默认决策表）, 用户以 PRD 为基线全盘确认, 访谈 8 项决策（D9-D16）均未引入替代方案之争; 符合"方案唯一且用户已定"跳过条件

## Phase 6 审查记录（2026-11-12）
- 四视角子代理: blocker 1（多角色交集语义错误→已修为显式授权并集+不隐式提权）/ major 4（提审自动测试丢失→已补 Requirement+任务; M2 Builder Agent 无沙盒→design D11 过渡决策; 状态机迁移表缺失→已补完整迁移表; 沙盒受控代理无载体→已补 Requirement+任务 7.4）/ minor 12（全部修正: 引用更正/AT-12 补验 4.7/AT-17 页面场景/origin 可见性/N7 任务可见性/取消成果规则/模糊表述/等待超时/控制通道/编号约定/探活/Skill 授权/决策溯源）
- CLI: validate --strict 通过（零警告）; status 4/4 artifacts
- 账本: 9 条真实调用（grilling×2, openspec-cli×4, openspec-propose×1, subagent×2）; think 合规跳过（本文件 Phase 3 预判节有记录）
- **审查结论: blocker 0 / major 0 / minor 0（17 项审查问题全部修正）**

## 下一步
- **已交接**: SPEC `forgegent-v1-platform` 获用户批准（2026-11-12）, 进入实施阶段
- 实现用 openspec-apply-change 工作流（tasks.md 从 M0 组 1.x 起步）
- 需求变化用 openspec-update-change（修订现有 change 或新开 change）
- 完成后 openspec-archive-change 归档
