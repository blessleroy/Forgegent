# Le SPEC 状态 — Forgegent（智体工坊）V1
更新: 2026-11-17 | 阶段: **已归档（forgegent-v1-remediation 实施完成→verify 通过→用户批准→归档: specs 同步 10 added + 43 modified, 全 12 主线 spec validate --strict 通过; change 存于 changes/archive/2026-11-17-forgegent-v1-remediation）** | 复杂度: complex（多域断链修复 + 沙盒/LLM/交互接线，架构级改动多处）

## 遗留（供后续会话）
- **未提交**：全部实施改动未 commit（等用户指示分批/单 commit）
- **N11 未裁**：ZIP Skill 投稿需解压依赖（现支持 JSON files-map）
- Linux 目标机最终验收（D10）与 gVisor 级容器隔离实机验证待部署环境

## verify-change 结论（2026-11-17, 自查版）
- Completeness: 38/38 任务；42 MODIFIED + 11 ADDED 需求全部有实现与测试映射
- Correctness: 53 个 delta 场景中 51 个有专属测试; 2 个为部署面场景（Docker 安全参数真实生效/出网白名单拓扑）由 r3-backend 参数审计 + 代理白名单测试间接覆盖 + AT-20 容器实跑——记 WARNING（容器内 gVisor 级验证属部署环境依赖）
- Coherence: design D28-D47 全部落实; 代码模式与既有风格一致（无 suggestion）
- **critical 0 / warning 1（上述）**: Ready for archive

## R3+R4 实施记录（2026-11-17）
- R3 沙盒: DockerBackend（docker CLI, 默认 seccomp〔删除非法自定义值〕/cap-drop ALL/uid 65534/只读 rootfs/pids 上限/internal 网络; 修正 buildDockerRunArgs 出网拓扑=网络而非 --add-host 伪过滤）; ControlledProxy 双模式（模型透传 host 侧注 Key + /forward 白名单转发, 按 token 授权）; executor sandbox.exec 平台工具（仅 sandboxed 任务注入; 通道不可用→结构化失败绝不降级）; per-task workspace 挂载进容器（技能脚本/输入可见）; 终态 teardown + waiting_input 保活 + 60s 空闲 sweep; compose internal 网络 + rootless sock + sandbox-base 镜像 target + README 部署节
- R4: 4.1 UI 六项（撤回按钮/员工视角 Schema 预览/审核拒绝理由双端/成员+部门授权面板/Hub 分类 N9/文件预览）; 4.2 闸门真实执行（在线发起 origin=test 隔离任务附 taskId, 离线标注——顺带修复 submit 路由根本没接闸门的暗洞）; 4.3 预算（maxDurationSeconds 执行期收紧 timeout; 单价字段→estimated_cost; 未配置→0+注明; maxCostCents 超限终止; toolCalls 真实计数）; 4.4 审计页 action 过滤+运行失败查询+24h 拒绝聚合, runner log 走 logJson 脱敏; 4.5 幂等持久化（0006 迁移 idempotency_keys, poster 注入持久层, 冒烟实测缓存命中）; 4.6 AT-20 冒烟（mock SSE 流式模型 + 全链路驱动脚本, **PASS**）; 4.7 compose 真实实测 P50 1.5-1.9ms/P95 2.0-3.9ms 落盘; 4.8 decisions.md/README 如实化
- **冒烟发现并修复的三个真实 bug**: ① compose seed 变量名 typo（FORGEENT_SEED_DEMO→FORGEGENT_SEED_DEMO, demo 从未种入）② better-auth 通用限流按 IP×路径计 /get-session, 而每个守卫 API 都打它 → 正常浏览 10 次/分即全站 401（customRules 豁免 get-session; /sign-in 严格规则保留）③ pi 走 stream:true, mock 需 SSE（生产无影响）
- **N11（待用户裁定）**: ZIP Skill 投稿需解压依赖（违反 §0.5 锁定依赖）——当前支持 JSON files-map 投稿
- 全部验证: 197/197（新增 49 项回归: r1×3 套/llm-backend/d46/gate/r2-tools/r2-runtime/r3×2/poster 持久化/ui-schema）+ typecheck + build + validate --strict + AT-20 PASS

## R2 实施记录（2026-11-16, 全部验证通过: 185/185 + typecheck + build）
- 2.1-2.2 LlmBuilderAgent（进程内直连 OpenAI 兼容 chat, JSON 容错提取+校验+反馈重试一次; resolveBuilderBackend 端点/密钥可用性选择; Studio UI 离线演示模式徽章; FORGEGENT_BUILDER_MODEL 覆盖模型名）+ LLM 修改对话（任意自然语言结构化变更）
- 2.3 生成物补全（usage/embeddedSkills/icon/真实 modelRef——executor 按 id/name 解析模型资源, 回退默认端点）+ D37 引用校验（skillRefs 授权+published、http.* 声明、resourceRefs 存在→拒绝式保存+可用列表; 能力引用类按 PRD §6 从宽——**spec 已同步一行修订**; PRD 示例值 artifact.save/model-approved-001 合法）
- 2.4 D46 连带审核: reviewDraft approve 把 embeddedSkills 发布为 skill_versions（submitter=Builder/reviewer=Admin/哈希锁定）并回填 skillRefs 进不可变快照
- 2.5 投稿落盘（submissions/<id> 持久化, approve 发布=投稿内容, 附属文件回读）+ 撤销记 revoked_by（迁移 0004: is_scripted/revoked_by）
- 2.6 skillsOverride 生产接线: executor 消费 skillRefs→loadApprovedSkills 哈希校验→写入任务工作区→pi skillsOverride（SourceInfo 完整字段）
- 2.7 isScriptedPackage 检测（脚本扩展名+依赖清单）; 脚本 Skill 绑定 restricted 草稿→保存拒绝; embedded 脚本+restricted→发布拒绝
- 2.8 resources.search 工具（ACL-first + 不可信内容包裹 UNTRUSTED_DOC_FRAMING）; 2.9 http.* 执行器（声明式 Schema→Type.Unsafe, GET/POST 映射, 服务端 Bearer, 幂等键, 截断）; 2.10 W10 显式写拒绝+审计
- 2.11 request_input 挂起工具（以工具事件为准; 非网关包装的控制工具）→ waiting_input 释放租约/并发槽; 会话锁覆盖 waiting 态
- 2.12 pi 原生 resume: per-task workspace `work/<taskId>/`（会话 .pi-sessions/ + inputs/ + .forgegent-skills/）; SessionManager.findById/open 恢复; 采纳 pi sessionId 写回 tasks+session_refs; pending_followup 队列（迁移 0005）: continue 消息入队→可恢复领取（running+无租约的原位领取, 先取后清）→下一轮 userMessage 组合原始需求+员工后续
- 2.13 调度器: Promise.race 增量补位（快任务不再等慢任务）; execute 内自续租（renewLease 接线, 长任务不再被 reclaim 误伤）; 1.2 补齐: AbortController 贯穿 guards→executor→pi（超时/取消→dispose 会话）
- 2.14 document-flow 四区块渲染 + form-result/file 字段上传（个人空间→inputFileIds）+ 任务详情成果区（下载+图片预览, GET /api/tasks/:id 返回 outputFiles）+ 输入副本投递（文本进 prompt/二进制进 inputs/, ACL 逐文件校验, inputs.delivered 事件）
- **实施发现（记录）**: vitest 别名原只覆盖 4 包（registry/studio 等解析到 stale dist）→ 扩到全部 10 包; better-auth 硬编码 /sign-in 特殊限流 max=3/10s; pnpm 任务循环（skills 旧的无引用 registry 依赖已删）; ZIP 投稿需解压依赖→列 N11 待用户裁定
- tasks.md: R1(9)+R2(14) 全勾, R3(5)+R4(10) 待做

## R1 实施记录（2026-11-16, **已验证通过**）
- 1.1 产物路径统一: executor `createProductionDeps(db, workspaceRoot, artifactRoot)` + index.ts 传 `dataDir()/files`（apps/runner/src/executor.ts, index.ts）
- 1.2 取消竞态: `finishLeasedTask` 状态机 CAS（outcomes 仅自 starting/running; cancelled 保态放租约; 拒绝且租约仍在时释放并记 `task.finish_refused` 事件）packages/db/src/queue.ts。**AbortSignal 传播推迟到 R2**（session/prompt 重构时一并接线, 届时 1.2 才勾选）
- 1.3 重置密码: scratch signup 生成同参 scrypt 哈希→单条 UPDATE 原位换 credential（无锁死窗口）+ must_change_password=1 + 吊销全部会话（admin/users/route.ts）
- 1.4 强制改密服务端: guardRequest 查 must_change_password 拒绝一切守卫 API（403 password-change-required + 审计）; 演示/测试账号默认 false 不受影响（guard.ts）
- 1.5 停用拒登录: auth.ts databaseHooks.session.create.before 抛 APIError(FORBIDDEN); set-status disabled 同步吊销会话
- 1.6 CSRF: apps/web/src/middleware.ts 中央 Origin 校验（全部 /api/* 变更方法, 复用 checkSameOrigin）
- 1.7 SSE 脱敏: appendTaskEvent 统一过 redact()（packages/db/src/events.ts）
- 1.8 下载防御: 下载路由改走 FileStore.openDownload（key 校验/realpath/流式, NOT_FOUND 与 FORBIDDEN 同映射 404 防存在性泄露）
- 1.9 Gateway 真实角色: gatewayCtx.roles = await rolesForUser(db, task.ownerId)（executor.ts）
- **验证结果（shell 恢复后 2026-11-16 全部执行）**: `openspec validate --strict` ✅（补回 5 处 MODIFIED 基线场景后通过）｜ typecheck ✅ ｜ build ✅ ｜ test **158/158** ✅（148 基线 + 10 新回归: db/r1-fixes 4 项取消竞态与脱敏、web/r1-fixes 4 项账号与 CSRF、runner/r1-fixes 2 项产物根与真实角色）｜ 账本已回补
- **实施中发现并解决的两个深层事实**（值得沉淀）: ① better-auth 配 secondaryStorage 后会话**只存 kv 缓存**（sessions 表可为空）, 吊销必须走其 `revoked-sessions-before-<uid>` 水位机制（apps/web/src/lib/sessions.ts）② better-auth 对 `/sign-in/*` 有**硬编码特殊限流 max=3/10s**（getDefaultSpecialRules, 覆盖任何配置、按共享 kv 计数）——测试需清计数器或拉开间隔; 生产端无影响（真人不会 10s 内 4 连登）
- tasks.md 已勾 1.1/1.3-1.9; 1.2 保持未勾（AbortSignal 随 R2 session 重构接线）; compose 双进程产物下载断言由 4.6 冒烟承载
- lint 存量报错（require-imports/未用变量/next-env.d.ts）在干净 HEAD 同样存在, 非本次引入, 不在 R1 范围

## Phase 5/6 执行记录（2026-11-16）
- 旧 change forgegent-v1-platform 已归档（openspec archive -y, 87 需求同步主线 specs/, 存档 changes/archive/2026-11-16-forgegent-v1-platform）, D32 落地
- 新 change forgegent-v1-remediation 已生成全部 artifacts: proposal + 12 delta specs（42 MODIFIED + 11→12 ADDED）+ design + tasks（4 任务组 37 项）
- Phase 6 四视角子代理审查: **blocker 0 / major 5 / minor 7** → 5 major 全部修复（①tasks 补文件治理任务 4.10 ②4.1 补 AT-17 页面拒绝 ③⑯ Gateway 角色硬编码补溯源+任务 1.9 ④三处被 MODIFIED 静默删除的 PRD 级 MUST 补回〔密码哈希/预装镜像+复用沙盒+AT-07 场景/能力引用不含密钥〕⑤沙盒进程拓扑定稿〔Pi 编排宿主+不可信执行体进容器, spec scenario 与 design 同步改写〕）; minor 7 中 6 项已修（#6 补回 6 句 SHALL/治理语句、#7 sessionDir 统一为 workspace 内、#8 幂等改 MODIFIED 合并、#9 FORGEENT_SEED_DEMO 注明沿用既有变量名、#10 三处可判定性强化、#11 裸 WHEN/THEN 补场景标题）, #12 转为确认包「显式偏离」呈示
- **环境故障如实声明**: 会话 Bash 工具持续 ENOENT（主线程与子代理均复现）, `openspec validate` 与两笔账本追加（Phase 6 审查、本节）未能执行; 已人工核对 delta 语法结构（节头/需求名与基线逐字一致/场景标题齐全）。**实施前置**: shell 恢复后立即补跑 `openspec validate forgegent-v1-remediation`（严格）+ 账本回补, 失败则先修再开工

## 第二轮：Remediation（2026-11-16 发起）

### 原始输入摘要（第二轮）
- (来源: 用户 + PRD vs 实现 review 报告) "根据前面的分析，生成 SPEC 进行开发"——对 5 个只读审查子代理 + 主线程抽查核实的 15+ 项缺口做修复 SPEC 并开发
- Review 核心发现（均已 file:line 核实）:
  - **断链主流程**: ① 产物存储根错位（runner 写 `data/runner/files`, web 读 `data/files` → 生产下载必然 500, AT-04 断链）② Builder Agent 纯关键词启发式, LLM 接线不存在（route.ts 无条件 HeuristicBuilderAgent）③ 沙盒空壳（无 DockerBackend 类, buildDockerRunArgs 纯函数仅测试引用且 seccomp 值非法; runner 无条件 restricted, task.mode 无消费者; ControlledProxy 无生产启动点）④ Skill 生产加载断链（loadApprovedSkills 零生产调用方; skillRefs 不被 executor 消费; 投稿内容未落盘, approve 发布的是管理员请求体; skill_bindings 授权不校验）⑤ 方案专家闭环不可用（searchSharedDocs 无生产调用方; HTTP 工具无执行器; waiting_input 生产不可达）⑥ document-flow 模板不渲染 + 任务页无文件上传 UI
  - **正确性/安全 bug**: ⑦ finishLeasedTask 盲写覆盖 cancelled→completed ⑧ admin 重置密码删 credential 后 signUpEmail 必败锁死用户 ⑨ must_change_password 服务端不拦 ⑩ 停用用户可过 better-auth 登录（仅业务 API 拦）⑪ CSRF Origin 校验仅 1 路由接线 ⑫ SSE 事件不过 redact（run.failed.reason 带原始错误）⑬ 下载路由绕过 FileStore 防御（裸 join+readFileSync）⑭ continue 消息没喂给模型（续跑用旧 inputSummary）⑮ lease 续租零调用 + 调度波次化 ⑯ gatewayCtx.roles 硬编码 `["employee"]`（apps/runner/src/executor.ts:133-137, Phase 6 审查补记——所有权检查不受影响故低危, 但违反 FR-09.3 上下文真实性, 修复入任务 1.9）
  - **功能缺口**: Hub 分类零引用; 生成物缺 skillRefs/resourceRefs/使用说明/icon, modelRef 恒 default; Studio 无撤回按钮/员工视角预览/拒绝理由显示/per-user 部门授权 UI; 提审"自动测试"是静态检查; 文件无 MIME 白名单/保留策略/配额调整接口; 预算 maxDurationSeconds/maxCostCents 无消费者, estimated_cost 恒 0, toolCalls 记产物数; 审计页不能查运行失败; logJson 生产零调用; 输入文件不进工作区; session_refs 只写不读; revoked 不记撤销人; W10 显式写拒绝未做; AT-17 页面级拒绝缺失; AT-20 无自动化测试; 性能基线全 mock
  - **文档失实**: tasks.md 52/52 全勾 + state.md"遗留不阻塞"与实际不符; decisions.md 声称 Rootless Docker 生产
- 事实基线: 测试 148/148 全绿（32 文件）, 构建干净——测试测的是"现有代码"而非 PRD 要求; Registry/guard/Gateway/快照/脱敏等基础层质量高

### 第二轮十类分拣（要点）
1. **明确需求**: 修复上述 ①-⑮ 断链与 bug; 补齐 P0 功能缺口; 文档如实化; 修复以 PRD 为验收基线（AT-01~AT-20）
2. **目标与期望结果**: V1 真正达到 PRD §14 DoD 八条（当前 DoD#2 方案 Agent 不可用/#5 沙盒未用/#6 取消 bug/#8 AT-20 手工）
3. **角色与场景**: 不变（Admin/Builder/Employee, §2 矩阵沿用）
4. **未定想法**: [未定] change 组织（单 change 分组 vs 拆两个）; [未定] 沙盒处置（真实现 vs 本期降级拒绝 sandboxed）; [未定] LLM Builder Agent 模型来源与无端点行为; [未定] AT-20 自动化与性能实测是否纳入; [未定] 旧 change v1-platform 归档时机; [未定] 小 UI 缺口是否全纳入
5. **用户假设**: PRD 仍是基线且修复不得反向扩大范围（§0.7 沿用）
6. **约束**: PRD §0/§7 禁入清单不变; 已验证正确的基础层（guard/快照/脱敏/租约）不动; 每项修复带回归测试; D10 最终验收在 Linux（开发机 macOS 用 Docker Desktop 等价验证）
7. **矛盾描述**: v1-platform tasks.md"52/52 完成"与 review 事实不符（流程性矛盾, 非产品矛盾）; decisions.md"Rootless Docker 生产"与空壳实现不符
8. **重要缺失信息**: pi SDK 是否支持 session resume（影响 continue 上下文方案, Phase 3 子代理核实）
9. **已否定方案**: 沿用 PRD §1.3/§7 全部 + 上轮已否定方案; 本轮新增否定: "以测试通过当作完成"（review 证伪）
10. **明确不做**: P1 全部（/requests、/admin/usage、自定义 React UI、SSO、OTel、gVisor 实装、连接器扩展）

### 第二轮已核实事实（grilling「事实自己查」, 子代理 2026-11-16）
- **pi SDK 1.5.2 原生支持会话恢复**: `createAgentSession({ sessionManager: SessionManager.open(path) | continueRecent(cwd) | findById(cwd, id) })`; 无 `session.load()`/`prompt(sessionId)`, JSDoc 的 `continueSession: true` 是过时注释不可用
- 会话文件默认存 `~/.pi/agent/sessions/--<编码cwd>--/<ts>_<id>.jsonl`（JSONL 树, version 3）; `open(path, sessionDir?)` 可覆盖 sessionDir → 可按任务隔离存到任务 workspace
- 同一 session 可多次 `prompt()` 上下文自动延续（流式中需 streamingBehavior/steer/followUp; 收敛用 waitForIdle()）; 读取历史: `session.messages` / `SessionManager.getEntries()/buildSessionContext()/list()`
- **含义**: 缺口 #14（continue 语义）可用原生 resume 修复——per-task sessionDir + SessionManager.open 按 sessionId 恢复, 而非只把消息拼回 prompt; 官方文档明示 "SessionManager is authoritative for finalized model context"（docs/sdk.md:40）
- **测试现状事实**: 148/148 全绿（32 文件）复验通过; 全部 AT 映射见 review 报告（AT-07/12/17/20 为组合覆盖或手工）

### 第二轮访谈计数
轮次: 2 ｜ 检查点: 轮 2 = Phase 4 acceptance-driven 澄清（R-Q7 blocking / R-Q8 验收判据）; 其余 8 项 major 已推导入 D37-D45, 3 项 minor 入 N8-N10; 轮 2 答完 blocking 清零, 复核受影响项（D37 与 D46 一致: 连带审核落库后 refs 校验口径不变）, Phase 4 收口

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
### 第一轮（2026-11-12, D1-D27）
| # | 决策 | 内容 | 来源 | 状态 |
|---|------|------|------|------|
| D1 | 产品契约 | 少数授权者用 Agent 造应用, 多数员工像用 Web 软件一样使用已发布应用 | PRD §1.1 | 已确认（PRD 基线） |
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

### 第二轮 remediation 决策（2026-11-16, 用户"全按推荐"）
| # | 决策 | 内容 | 来源 | 状态 |
|---|------|------|------|------|
| D28 | change 组织 | 单个新 change `forgegent-v1-remediation`, 分四任务组: R1 快速修复（产物路径/取消竞态/账号与安全 bug）/ R2 智能与接线（LLM Builder Agent/Skill 链/共享资料+HTTP 工具/waiting_input/document-flow/continue）/ R3 沙盒真实现 / R4 收尾（UI 缺口/可观测/AT-20 自动化/文档如实化） | 用户 R-Q1=推荐 | 已确认 |
| D29 | 沙盒处置 | 按 PRD 真实现: DockerBackend（修正非法 seccomp、真出网控制）+ Runner 按会话接线（mode 分支/空闲回收/ControlledProxy 生产启动）+ 脚本型 Skill 检测路由（W7）; 不降级拒绝 | 用户 R-Q2=A | 已确认 |
| D30 | LLM Builder Agent | 复用管理员配置的 OpenAI 兼容端点（resources 表, 可指定 builder 专用 chat 模型名）; 无可用端点回退启发式且 Studio UI 明示「离线演示模式」; 启发式不再冒充智能 | 用户 R-Q3=A | 已确认 |
| D31 | 验收收尾 | AT-20 自动化（compose 冒烟脚本: 起容器→seed→海报闭环断言）+ 真实部署 Web API P50/P95 实测记录纳入本期 | 用户 R-Q4=推荐 | 已确认 |
| D32 | 旧 change 处置 | forgegent-v1-platform 按当时验收口径归档留痕; 缺口全部由新 change 承接; state.md/decisions.md 同步修正失实描述 | 用户 R-Q5=A | 已确认 |
| D33 | UI 缺口范围 | 六项全纳入（撤回按钮/员工视角 Schema 预览/审核拒绝理由显示/per-user+部门授权 UI/Hub 分类/文件预览）, 排 R4 收尾组 | 用户 R-Q6=推荐 | 已确认 |
| D34 | LLM Builder Agent 架构 | 进程内直连 OpenAI 兼容 chat 的 LlmBuilderAgent（对话历史+草稿 payload 组装 prompt → JSON 输出 → 严格校验+失败重试 1 次）; 不走 pi 会话/不经 Runner 队列; 无端点回退启发式; +1 env FORGEGENT_BUILDER_MODEL | 用户批准 T1（2026-11-16） | 已确认 |
| D35 | waiting_input 机制 | resume 会话 + request_input 挂起工具: executor 注入经 Gateway 白名单的 customTool, 模型提交中间产物调用之 → 任务转 waiting_input（session JSONL 已自动持久化）; continue 时 SessionManager.open(任务 sessionDir) 恢复 + prompt(员工回复), 同一上下文任意轮修改; executor 以工具调用事件为准（模型不停笔也不破坏正确性） | 用户批准 T2（2026-11-16） | 已确认 |
| D36 | DockerBackend 与出网 | docker CLI 子进程真实现（seccomp 用默认 profile+cap-drop ALL+no-new-privileges+read-only+uid 65534+资源上限）; internal bridge 网络 + ControlledProxy 唯一出口（host 侧注 Key, 按 Release 白名单转发）; compose runner 挂 rootless sock（控制平面访问, 非 PRD 禁项）; sock 不可用 → sandboxed 任务 failed+结构化原因（N6）, restricted 不受影响; 否决 dockerode（新依赖且不可审计）; 否决 --add-host 伪过滤 | 用户批准 T3（2026-11-16） | 已确认 |

### Phase 4 反向验收推导决策（major 处置, 2026-11-16, 独立子代理产出 → 按已确认决策推导）
| # | 决策 | 推导依据 | 状态 |
|---|------|------|------|
| D37 | LLM 生成物 refs 校验: 草稿保存/更新时对 skillRefs/toolRefs/resourceRefs/modelRef 全量校验「已发布 + 该 Builder 已授权」; 失败拒绝保存并向 Builder 报错附可用授权列表（LLM 重试 1 次仍失败即返回错误）; 不做静默剔除 | D19 + D30「不冒充/不静默降级」 + skill-registry spec「无权绑定拒绝留痕」 + AT-01 生成物完整性 | [推导] |
| D38 | LlmBuilderAgent（D34 进程内直连）不受 sandbox spec「Builder Agent MUST 沙盒」旧文约束; 沙盒义务落在草稿测试运行的脚本执行与脚本型 Skill（W7）; remediation delta spec 修订 sandbox-isolation 措辞, 避免与 D32 文档如实化自相矛盾 | D34 更晚且更具体 + FR-08.2 立法目的（不可信脚本/代码构建, 非 JSON 生成） | [推导] |
| D39 | waiting_input 生命周期: 释放租约与并发槽（非执行态, 不占 5 并发）; session 独占语义保留（continue 重新排队领取）; 无自动超时, 挂起至 continue/cancel; sessionDir 在宿主任务 workspace（沙盒按需挂载, 回收不丢失）; 单轮多次 request_input 以首次为准 | PRD §8.3「5 个并发**执行**任务」 + tasks 7.6「waiting 不计最大时长」 + AT-14 + 已核实事实（open 可指定 sessionDir） | [推导] |
| D40 | 员工运行中回复 = 排队投递（记为事件, 至 waiting_input 或轮末随 resume prompt 注入）; 不做即时 steer/followUp | D35 批准的恢复机制 + FR-03.4 无即时性要求 | [推导] |
| D41 | 离线演示模式下提审闸门: 自动测试附「未运行（离线演示模式）」结果放行, 审核者可见标注 | N5 非阻断设计（失败仍可提交, 结果附审核者） | [推导] |
| D42 | Builder 模型配置调和: 端点/凭证只在 resources 表; 模型名解析顺序 FORGEGENT_BUILDER_MODEL(env) > 表内模型名 | D11 + D30「resources 表」+ D34「+1 env」调和, 无新配置面 | [推导] |
| D43 | 重置密码语义: Admin 设临时密码（线下交付, V1 无邮件）+ must_change_password=1 + 吊销该用户全部既有会话 | FR-10 + D14 先例 + 既有 change-password revokeOtherSessions 先例 | [推导] |
| D44 | 预算定价: 模型资源配置加可选单价字段（input/output per-M-token, Admin 维护）; 未配置单价 → estimated_cost=0 且 maxCostCents 不触发（事件注明「未配置单价」）; maxDurationSeconds 恒执行 | D11 管理员配置 + N6 结构化失败 + [默认] | [推导] |
| D45 | document-flow 阶段映射: 状态驱动渲染（waiting_input=消息区+中间产物预览, running=进度区, completed=下载区）; request_input payload 附 kind 字段（outline/draft 等）区分多轮确认, 不引入结构化确认卡 | D27「不做结构化确认卡」 + task-execution spec 大纲确认场景 | [推导] |
| D46 | 生成型 Skill 连带审核: Builder 提审 Agent 时 Admin 审核界面同时展示内嵌 Skill 内容; 批准发布即自动落 skill_versions（status=published, submitter=该 Builder, reviewer=该 Admin, 锁内容哈希）并入 Skill 库供其他草稿绑定; 员工独立投稿流（3.3 旅程）不变; 「未审核不进生产」不变量保持（发布即审核动作）; 否决两段审核（PRD §8.1 单段发布流程无此步骤） | 用户 R-Q7=A（2026-11-16） | 已确认 |
| D47 | AT-20 冒烟脚本内置 mock OpenAI 兼容端点容器可接受: 冒烟考察部署/seed/容器编排/接线正确性; 真实性由 D31 真实部署性能实测与人工验收承担; 测试日志如实标注 mock 边界 | 用户 R-Q8=推荐（2026-11-16） | 已确认 |

## 非阻塞事项（minor, 随 SPEC"非阻塞事项"呈现）
- N1 发布范围默认: 未显式授权 = 无人可见（仅 Admin）[默认, 安全默认]
- N2 Hub 分类: Admin 管理的固定目录 [默认]
- N3 部门模型: 新增 departments + user_departments 表, 授权判定实时计算 [默认, 推导]
- N4 Studio 对话持久化（新增表）; Builder 测试运行入 tasks 标 origin=test, 仅 Studio 可见不进员工 /tasks [默认, 推导]
- N5 自动测试闸门: 提审时运行, 失败仍可提交但结果附给审核者 [默认]
- N6 超时/超预算 → failed + 结构化原因, 可 continue 或新建任务重试 [默认]
- N7 任务/文件共享 V1 不做, API 权限中"授权者"仅指 Admin; 应用包导入/导出入口补进 /admin/agents [默认, 推导]
- N8 历史数据不写迁移脚本（预发布开发数据）; README 升级注记（data/runner/files 可手动并入 data/files 或清空）; 旧 interrupted 任务在新 resume 机制下恢复失败 → failed+结构化原因（N6 同构）[Phase 4 m1 默认]
- N9 Agent 分类由 Admin 指定（草稿 payload 可建议 category, 审核时可改）; 未分类落「未分类」区块; 非必填 [Phase 4 m2 默认]
- N10 性能实测核心接口清单 = /api/agents、GET /api/tasks、GET /api/files、/api/tasks/:id/events(SSE 首连); 文件保留策略 V1 = 不自动删除、仅配额限制（同 D22 先例）[Phase 4 m3 默认]

## 已否定方案
- 员工全员可建 Agent / 通用聊天首页 — 与产品契约冲突（PRD §1.3）
- Dify/Coze 式节点工作流编辑器 — Agent-first 原则否定（PRD §1.2/§1.3）
- SaaS 多租户/跨企业共享 — V1 单企业实例（PRD §1.2）
- NestJS 微服务 + Redis/MQ/S3/K8s 全家桶 — 违反简单可部署（PRD §7）
- 进程崩溃后任意指令级精确恢复 — 承诺过高, 只做持久化上下文恢复（PRD §1.3）
- V1 内置所有外部连接器 — 改为管理员配置的文件/HTTP API（PRD §1.3）
- 仅靠 Prompt/前端隐藏做安全 — 必须服务端+执行端落实（PRD §0.4）

## 开放问题
### 第一轮（2026-11-12, 全部关闭）
- [x] ~~Q1 范围~~ → D9 ｜ ~~Q2 环境~~ → D10 ｜ ~~Q3 模型~~ → D11 ｜ ~~Q4 语言~~ → D12 ｜ ~~Q5 OpenSpec~~ → D13 ｜ ~~Q6 初始 Admin~~ → D14
- [x] ~~Q7 i18n 范围~~ → D15 ｜ ~~Q8 生图能力~~ → D16 ｜ ~~Q9 waiting_input 闭环~~ → D27

### 第二轮（2026-11-16, remediation）
- [x] ~~R-Q1 change 组织~~ → D28 ｜ ~~R-Q2 沙盒处置~~ → D29 ｜ ~~R-Q3 LLM Builder Agent~~ → D30 ｜ ~~R-Q4 验收收尾~~ → D31 ｜ ~~R-Q5 旧 change~~ → D32 ｜ ~~R-Q6 UI 缺口~~ → D33（用户 2026-11-16 "全按推荐"）
- [x] ~~R-Q7 生成型 Skill 审核路径~~ → D46 ｜ ~~R-Q8 AT-20 mock 端点~~ → D47（用户 2026-11-16 "同意，继续", Phase 4 blocking 清零）

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
- 用户已批准（2026-11-16「批准」）→ 实施开始
- 实施前置: 补跑 openspec validate --strict + 账本回补（shell 故障期间欠账）
- 实现用 openspec-apply-change 工作流（tasks.md 从 R1 组 1.1 起步）, 需求变化用 openspec-update-change, 完成后 openspec-verify-change + archive
