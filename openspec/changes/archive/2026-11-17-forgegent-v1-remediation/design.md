# Design

## Context

本 change 是对已归档 `forgegent-v1-platform` 实现的定向修复与生产接线（缺口全表见 `openspec/le-spec/state.md` 第二轮「原始输入摘要」）。基础层（角色守卫、Tool Gateway、不可变快照、审计脱敏、租约队列、FileStore 防御、Better Auth 集成）经审查确认质量良好且带测试——本 change 不重构它们，只接线与修补。技术选型争议已在 Phase 3 think 解决并获用户批准（D34-D36）；Phase 4 反向验收的推导决策 D37-D45 与用户澄清 D46-D47 一并沉淀于此。

## Goals / Non-Goals

- **Goals**：PRD P0 主链路真实可用（产物下载、LLM Studio、Skill 生效、方案 Agent 闭环、沙盒、账号安全）；DoD 八条真实达标；文档如实。
- **Non-Goals**：P1 全部（自定义 React UI、/requests、/admin/usage 趋势、SSO、OTel、gVisor 实装、连接器、容器预热池）；不新增基础设施（PRD §0.2 禁入清单有效）；不重构已验证基础层；不承诺任意指令级崩溃恢复（PRD §1.3）。

## Decisions

| # | 决策 | 依据 |
|---|------|------|
| D28 | 单 change 四任务组 R1 快速修复 / R2 智能与接线 / R3 沙盒 / R4 收尾；R2 的 W7 依赖 R3 就绪 | 用户 R-Q1 |
| D29 | 沙盒按 PRD 真实现，不降级拒绝 | 用户 R-Q2 |
| D30/D34/D42 | Builder Agent = 进程内直连 OpenAI 兼容 chat 的 `LlmBuilderAgent`（不走 pi 会话、不经 Runner 队列）；无端点回退启发式 + Studio 明示「离线演示模式」；端点/凭证只在 resources 表，模型名 `FORGEGENT_BUILDER_MODEL` > 表内模型名 | 用户 R-Q3 + think T1 + Phase 4 M6 |
| D35 | waiting_input：`request_input` 挂起工具（Gateway 白名单，payload 带 kind）+ pi 原生 resume（`SessionManager.open(任务 sessionDir)`，员工回复为新 prompt）；以工具调用事件为准进入 waiting_input（模型不停笔不破坏正确性） | think T2 + SDK 核实事实（1.5.2 原生支持；JSDoc `continueSession` 为过时注释，禁止照抄） |
| D36 | DockerBackend = docker CLI 子进程（默认 seccomp profile + cap-drop ALL + no-new-privileges + read-only + uid 65534 + 内存/CPU/pids 上限）；出网 = internal bridge 网络 + Runner 进程内 ControlledProxy 唯一出口（host 侧注 Key、按 Release 白名单转发）；compose runner 挂 rootless sock；sock 不可用 → sandboxed 任务 failed+结构化原因 | think T3；否决 dockerode（新依赖不可审计）与 `--add-host` 伪过滤 |
| D37 | 草稿保存时全量 refs 校验（已发布+已授权），失败拒绝保存并附可用列表，LLM 重试 1 次后仍失败返回错误 | Phase 4 M1 |
| D38 | LlmBuilderAgent 生成进程不受「Builder Agent MUST 沙盒」约束；沙盒义务 = 草稿测试的脚本执行、脚本型 Skill、生成代码构建；同步修订 sandbox-isolation spec 措辞 | Phase 4 M2（spec 文已改） |
| D39 | waiting_input 释放租约与并发槽（保留 session 独占）、无自动超时、sessionDir 在宿主任务工作区、单轮多次 request_input 以首次为准 | Phase 4 M3 |
| D40 | 运行中回复排队投递（事件记录 → waiting_input/轮末 resume 注入），不做即时 steer | Phase 4 M4 |
| D41 | 离线模式提审闸门附「未运行（离线演示模式）」放行 | Phase 4 M5a |
| D43 | 重置密码 = Admin 设临时密码 + must_change_password + 吊销全部会话；原子流程杜绝锁死窗口 | Phase 4 M7 |
| D44 | 单价挂在模型资源配置（可选 input/output per-M-token）；未配置 → estimated_cost=0 且费用预算不触发（事件注明）；maxDurationSeconds 执行期强制 | Phase 4 M8 |
| D45 | document-flow 状态驱动渲染 + request_input payload `kind` 区分轮次 | Phase 4 M9 |
| D46 | 生成型 Skill 连带审核：批准发布 Agent 即落 skill_versions（published，submitter=Builder，reviewer=Admin，哈希锁定）入库 | 用户 R-Q7 |
| D47 | AT-20 冒烟内置 mock OpenAI 兼容端点容器（考察部署接线），真实性由真实部署性能实测承担 | 用户 R-Q8 |

## 解决方案设计（按任务组）

### R1 快速修复

- **产物路径统一**：Runner `createProductionDeps` 的 artifact FileStore 根从 `workspaceRoot/files` 改为 `dataDir()/files`（与 Web 一致）；修复后 AT-04 下载链路回归。
- **取消竞态**：`finishLeasedTask` 改为经状态机（`transitionTask`）落终态，`WHERE state=from` CAS 拒绝 `cancelled→completed`；executor 加 AbortSignal 尽力中止（超时/取消传播到 pi run）。
- **账号三连**：重置密码改为原子流程（同一事务内先写新 credential 再删旧，杜绝锁死窗口）+ 吊销全部会话；`must_change_password` 进 `guardRequest`（仅放行改密端点）；停用经 better-auth ban/databaseHooks 拒登录 + 停用/重置时吊销全部会话。
- **CSRF**：`withCsrf` 包装器应用到全部变更路由（含 admin/tasks/files/skills/studio）。
- **SSE redact**：`appendTaskEvent` 复用 `redact()`；`run.failed.reason` 归类脱敏。
- **下载防御**：下载路由改走 `FileStore.get`（复用正则/realpath/流式）。

### R2 智能与接线

- **LlmBuilderAgent**（packages/studio）：组装 studio_conversations 历史 + 当前 payload → chat completions（严格 JSON 输出 prompt + 容错解析 + 校验 + 失败重试 1 次）→ `DraftPayload`；端点解析复用 resources 表逻辑；`builderAgent()` 按端点可用性选择后端，Studio API 返回当前后端模式。
- **生成物补全 + 校验**：payload 增 `usage`、`icon`、真实 `modelRef`、skillRefs（含生成型 Skill 内嵌草稿）、resourceRefs；`createDraft/updateDraft` 增加 D37 全量校验（skill 例外：生成型草稿随 D46 连带审核）；发布链路 `reviewDraft` approve 时把内嵌 Skill 落 skill_versions 并回填 skillRefs 哈希。
- **Skill 生产加载**：`runProductionAgent` 增加 `skillsOverride`（由 `loadApprovedSkills` 以快照 skillRefs 生成，哈希校验）；executor 从 `snapshot.payload.skillRefs` 装配；脚本检测（文件特征 + 声明）→ `mode` 提升沙盒或发布校验拒绝。
- **资源工具**：新增 `resources.search`（gateway 包装 customTool，ACL-first + 不可信包裹）与 `http.*` 执行器（服务端代理 + 幂等键持久表）；两者入 Gateway 白名单机制。
- **waiting_input/continue**：executor 注入 `request_input` customTool（提交中间产物 + kind）→ 捕获事件 → `transitionTask(waiting_input)` + 终止本轮；`continueTask` 恢复：per-task 工作区 `data/runner/work/<taskId>/`（会话目录 `<workspace>/session/`，沙盒挂载 workspace 即含会话，回收不丢失）+ `SessionManager.open` 装历史 + `prompt(排队消息+回复)`；调度器 lease 续租 + 并行领取（`Promise.allSettled` 波次改为常驻并发池）。
- **document-flow/UI**：`apps/[slug]` 按 template 分支渲染 document-flow 四区块（状态驱动）；form-result 文件上传字段；任务页成果区 + 预览（inline content-type 判断）。

### R3 沙盒

- `packages/sandbox`：实现 `DockerBackend implements ExecutionBackend`（execFile `docker run`，参数由修正版 `buildDockerRunArgs` 生成：默认 seccomp、cap-drop ALL、no-new-privileges、read-only + tmpfs、uid 65534、资源上限、挂载仅任务 workspace + 代理 socket/地址）；删除非法 seccomp 值。
- 网络：compose 增加 `forgegent-internal` internal 网络；Runner 加入该网；`ControlledProxy` 监听 internal 接口（生产启动于 Runner 进程）；创建容器时注入 `FORGEGENT_PROXY_URL` + 一次性 token。
- Runner 接线（进程拓扑，D36/D38）：Pi 编排循环运行于宿主 Runner（与 restricted 同构、受同一 Tool Gateway 管控，模型调用走既有 ModelRuntime）；`task.mode === "sandboxed"` 时不可信执行体（脚本型 Skill 脚本、命令、代码构建）经 SandboxManager 会话容器（复用/新建）在容器内执行，容器仅挂载该任务 workspace（含会话与授权文件副本）；空闲 sweep 与退出 teardown 挂到调度循环；无 sock → failed+结构化原因。
- 部署：compose runner 挂 `/run/user/<uid>/docker.sock`（env 可配）；README Rootless 前置与降级说明。

### R4 收尾

- UI 六项（撤回按钮、员工视角预览复用生产渲染器、拒绝理由展示、per-user/部门授权界面、Hub 分类筛选、文件在线预览）。
- 闸门真实执行（在线跑 origin=test 用例）；预算/单价/计数；审计页 action 过滤 + run.failed；logJson 接线 runner。
- AT-20 冒烟脚本（`scripts/smoke-compose.sh` + mock 端点小容器）；真实性能实测（N10 接口清单）；文档如实化（decisions.md 修正沙盒描述、state.md 遗留更新、README 升级注记 N8）。

## Risks / Trade-offs

- **最脆弱假设（整体）**：目标环境 Rootless Docker 可用——已设计降级路径（sandboxed 明确失败，restricted 不受影响）。
- **pi resume 行为**：SessionManager 恢复依赖 transcript 完整性；中断场景已有 `interrupted` 语义兜底，resume 失败 → failed+结构化原因（N8）。
- **mock 冒烟的诚实性**：D47 已限定考察范围并在日志标注；性能真实性由实测承担。
- **表面增量**：+1 env（FORGEGENT_BUILDER_MODEL）、resources config +可选单价字段、compose +internal 网络 +sock 挂载、+幂等记录表（或复用现有表扩展）；无新增 npm 依赖、无新增 API 端点。

## Migration Plan

- 无破坏性 schema 变更（新字段可空/可选）；发布快照格式向后兼容（旧快照无 skillRefs 资源引用则不加载 Skill）。
- 历史数据不写迁移脚本（N8，预发布开发数据）：README 注记 `data/runner/files` 手动并入或清空；旧 interrupted 任务 resume 失败按 N6 处理。
- 逐组独立可合并：R1 先行止血可单独发布；R2/R3 按依赖顺序；R4 收尾不影响前三组运行（phase independence）。

## Open Questions

无 blocking 未决。非阻塞默认见 N8-N10（state.md），随本 SPEC 呈交。
