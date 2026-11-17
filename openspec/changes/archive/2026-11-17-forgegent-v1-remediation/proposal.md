# Proposal

## Why

对 `forgegent-v1-platform`（已按当时验收口径归档）实现成果的独立审查（5 个只读审查子代理 + 主线程逐行核实，2026-11-16）发现：测试 148/148 全绿、Registry/权限/快照等基础层质量高，但**多条 PRD P0 主链路处于「库函数已写、生产未接线」或「演示级实现」状态**——测试通过是因为它们测的是现有代码而非 PRD 要求。PRD §14 DoD 当前不达标项：#2（方案 Agent 不可用）、#5（沙盒未使用）、#6（取消竞态/继续修改语义）、#8（AT-20 无自动化、性能基线全 mock）。本 change 以 PRD 为唯一验收基线修复全部缺口，并同步修正失实的文档记录（tasks.md 52/52、decisions.md「Rootless Docker 生产」、state.md 遗留描述）。

审查证据（均已 file:line 核实，全表见 `openspec/le-spec/state.md` 第二轮「原始输入摘要」）：

- **断链主流程**：① 产物存储根错位（runner 写 `data/runner/files`、web 读 `data/files` → 生产下载必然 500）② Builder Agent 纯关键词启发式、LLM 接线不存在 ③ 沙盒空壳（无 DockerBackend 实现、runner 无条件 restricted、ControlledProxy 无生产启动点、seccomp 值非法、`--add-host` 伪出网过滤）④ Skill 生产加载断链（loadApprovedSkills 零生产调用方、skillRefs 不被 executor 消费、投稿内容未落盘、授权绑定不校验）⑤ 方案专家闭环不可用（共享资料检索无工具、HTTP 工具无执行器、waiting_input 生产不可达）⑥ document-flow 模板不渲染、任务页无文件上传
- **正确性/安全 bug**：⑦ finishLeasedTask 盲写覆写 cancelled→completed ⑧ admin 重置密码删凭证后 signUpEmail 必败锁死用户 ⑨ must_change_password 服务端不拦 ⑩ 停用用户可过认证登录 ⑪ CSRF Origin 校验仅 1 路由接线 ⑫ SSE 事件不过 redact ⑬ 下载路由绕过 FileStore 防御 ⑭ continue 消息没喂给模型 ⑮ lease 续租零调用 + 调度波次化
- **功能缺口**：Hub 分类零引用、生成物缺 skillRefs/resourceRefs/使用说明/icon、Studio 无撤回按钮/员工视角预览/拒绝理由显示/per-user 部门授权 UI、提审闸门是静态检查、文件无 MIME 白名单、预算字段无消费者、审计页不能查运行失败、logJson 生产零调用、输入文件不进工作区、session_refs 只写不读、W7/W10 遗留、AT-17 页面级拒绝缺失

## What Changes

按四个任务组修复（组间有依赖：R2 的 W7 依赖 R3 沙盒就绪，组内排序已体现）：

- **R1 快速修复（止血）**：产物存储根统一（#1）；finishLeasedTask 走状态机消除取消竞态（#7）；账号生命周期三连——重置密码语义修复（Admin 设临时密码+强制改密+吊销会话，#8）、must_change_password 服务端强制（#9）、停用拒登录+吊销会话（#10）；CSRF Origin 校验接线到全部变更路由（#11）；SSE 事件过 redact（#12）；文件下载统一走 FileStore 防御（#13）
- **R2 智能与接线（M2/M3 真闭环）**：LlmBuilderAgent 真实接入 OpenAI 兼容 chat（进程内直连，无端点回退启发式并明示「离线演示模式」）；生成物补全（skillRefs/resourceRefs/使用说明/icon/modelRef）+ 保存时全量授权校验（拒绝式，附可用列表）；生成型 Skill 连带审核（发布即落 skill_versions 入库）；Skill 生产加载接线（executor 消费 skillRefs + skillsOverride 哈希校验）；投稿内容落盘 + 撤销记撤销人 + 绑定授权校验；共享资料检索工具（先 ACL 过滤再返回）+ HTTP API 工具执行器；waiting_input 生产可达（request_input 挂起工具 + SessionManager 原生 resume，continue 消息真实进入模型上下文，任意轮修改）；document-flow 渲染 + 任务页文件上传 + 输入文件授权副本投递；lease 续租 + 调度并行化
- **R3 沙盒真实现（FR-08）**：DockerBackend（docker CLI：默认 seccomp profile + cap-drop ALL + no-new-privileges + read-only rootfs + uid 65534 + 资源上限）；internal bridge 网络 + ControlledProxy 唯一出网口（真 egress 白名单，host 侧注 Key）；Runner 按 task.mode 分支接线、按会话复用、空闲 15 分钟回收、崩溃清理；沙盒后端不可用 → sandboxed 任务 failed+结构化原因（restricted 不受影响）；脚本型 Skill 检测路由（W7）；修订旧 spec「Builder Agent MUST 沙盒」措辞（LLM 生成进程不属沙盒强制场景，沙盒义务落在脚本执行与代码构建）
- **R4 收尾（DoD 闭环）**：六项 UI 缺口（撤回按钮/员工视角 Schema 预览/拒绝理由显示/per-user+部门授权 UI/Hub 分类/文件预览）；提审闸门真实执行测试用例（在线）+ 离线标注；预算执行（maxDurationSeconds 强制、单价配置与 estimated_cost、toolCalls 真实计数）；审计页查运行失败 + 拒绝数聚合 + logJson 生产接线；AT-20 compose 冒烟自动化（内置 mock 模型端点，考察部署接线）；真实部署 Web API P50/P95 实测（接口清单 N10）；文档如实化（decisions.md/state.md/README 升级注记）

## Capabilities

### Modified Capabilities

全部 12 个能力均修订（delta 见 specs/；MODIFIED 需求为完整替换文本，ADDED 为新需求）：

- `task-execution`: 状态机消除取消竞态覆写；waiting_input 生产可达（request_input 工具 + 原生 resume）；continue 复用同 session 且消息进入模型上下文；SSE redact；lease 续租与调度并行化；预算真实执行（时长/费用/单价/未配置降级）；新增产物存储统一、幂等持久化、输入文件授权副本投递
- `sandbox-isolation`: DockerBackend 真实现与容器约束修正；internal 网络 + 受控代理生产接线与真出网过滤；mode 分支接线与降级路径；生命周期清理生产接线；强制场景措辞修订（D38）
- `skill-registry`: 投稿内容落盘、审核发布内容=投稿内容、撤销记撤销人、绑定授权校验、脚本型 Skill 检测路由；新增生成型 Skill 连带审核（D46）、生产 Skill 加载接线
- `studio-building`: LLM 后端真实接入与离线演示模式（D30/D34/D42）；生成物七类完整；引用校验拒绝式（D37）；撤回按钮/员工视角预览/拒绝理由可见；闸门真实执行（D41）；Studio 页面级角色拒绝（AT-17 补全）
- `resource-governance`: 共享资料检索工具接线（AT-10 端到端）与不可信内容包裹；HTTP API 工具执行器；共享资料显式写拒绝留痕（W10）；模型单价配置（D44）
- `employee-hub`: document-flow 真实渲染（D45 状态驱动）；form-result 文件上传字段；任务成果区与在线预览；Hub 分类（N9）
- `identity-access`: CSRF 全路由；重置密码完整语义（D43）；must_change_password 服务端强制；停用拒登录+吊销会话
- `personal-files`: 下载走 FileStore 统一防御；MIME 白名单与配额可调；保留策略默认（N10）
- `audit-observability`: toolCalls 真实计数；拒绝操作数聚合；estimated_cost 依单价；logJson 生产接线；审计页运行失败查询
- `agent-registry`: 审核界面含内嵌 Skill（D46）与拒绝理由展示；发布范围 per-user/部门授权 UI；应用包 icon/modelRef 完整性
- `deployment-ops`: AT-20 冒烟自动化（mock 端点，D47）；真实性能实测（D31/N10）；沙盒部署前置（rootless sock + internal 网络）；升级注记（N8）
- `permission-enforcement`: Gateway 上下文使用任务主真实角色（修复硬编码）

### New Capabilities

（无——本 change 是对既有 12 能力的修订与补全）

## Impact

- **代码**：约 30+ 文件、9 个包；全部为「接线既有库层」或定向修复，不新增基础设施（PRD §0.2 禁入清单继续有效）；已验证正确的基础层（guard/快照/审计脱敏/租约队列）不动
- **API**：无新增端点；既有端点行为修正（重置密码、下载、SSE 事件内容）
- **新配置面**：`FORGEGENT_BUILDER_MODEL`（env，模型名覆盖，D42）；模型资源配置可选单价字段（D44）；compose 增加 internal 网络 + runner 挂 rootless sock（D36）
- **外部依赖**：无新增 npm 依赖（docker 经 CLI 子进程）；pi SDK 1.5.2 原生 SessionManager.open/continueRecent 支撑 resume（已核实）
- **决策溯源**：用户确认 D28-D33（范围/沙盒/LLM/验收/归档/UI）、D34-D36（think 方案）、D46-D47（acceptance 澄清）｜推导 D37-D45（Phase 4 反向验收）｜非阻塞默认 N8-N10；全表见 `openspec/le-spec/state.md`
- **验收**：PRD AT-01~AT-20 为基线；本 change 完成后 DoD 八条应真实达标（AT-20 自动化 + 真实性能实测入仓）
