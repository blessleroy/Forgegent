# Tasks

## 1. R1 快速修复（止血）

- [x] 1.1 统一产物存储根：Runner artifact FileStore 根改为与 Web 同一 `dataDir()/files`；验证 compose 双进程场景下任务产物经 /api/files/:id/download 成功下载（AT-04 回归）
- [x] 1.2 消除取消竞态：`finishLeasedTask` 走状态机 CAS，拒绝 `cancelled→completed` 等非法覆写；executor 传播取消/超时中止信号；验证「运行中取消后跑完不覆写终态」测试
- [x] 1.3 重置密码修复：原子流程（先建新 credential 再删旧）+ `must_change_password` + 吊销全部会话；验证重置后旧会话失效、新密码可登录且强制改密、无锁死窗口
- [x] 1.4 `must_change_password` 服务端强制：guardRequest 拦截（仅放行改密端点）；验证初始 Admin 未改密调用管理 API 被拒
- [x] 1.5 停用拒登录 + 会话吊销：better-auth 认证层感知用户状态；停用/重置吊销全部既有会话；验证停用用户无法登录且旧 Cookie 失效（D22 完整落地）
- [x] 1.6 CSRF 全路由：withCsrf 包装器应用到全部变更路由；验证跨站 Origin 的变更请求（任务/文件/草稿/管理）全部被拒
- [x] 1.7 SSE 事件脱敏：appendTaskEvent 过 redact、失败原因归类脱敏；验证事件流与 /events 补读中无绝对路径/凭证/秘密形状值
- [x] 1.8 下载防御统一：下载路由改走 FileStore（key 正则/realpath/流式）；验证篡改 storage_key、`../`、符号链接均被拒（AT-08 回归）
- [x] 1.9 Gateway 上下文真实角色：gatewayCtx.roles 取任务所有者真实角色集合（服务端实时计算），删除硬编码 `["employee"]`（executor.ts:133-137，FR-09.3）；验证 Admin 任务工具调用上下文角色正确且权限判定不变

## 2. R2 智能与接线（M2/M3 真闭环）

- [x] 2.1 LlmBuilderAgent：OpenAI 兼容 chat 直连（端点=resources 表，模型名 FORGEGENT_BUILDER_MODEL>表内值）、严格 JSON 输出+校验+重试 1 次、无端点回退启发式；验证 AT-01 用自然语言生成完整草稿 + 离线模式 UI 明示（D30/D34/D42）
- [x] 2.2 LLM 修改对话：任意自然语言结构化修改 + 差异展示；验证「加参考图上传/9:16/Word 说明」类指令产生字段级变更（AT-02 回归）且不匹配时明确反馈而非静默追加
- [x] 2.3 生成物补全与引用校验：payload 增 usage/icon/modelRef(真实)/resourceRefs/skillRefs(内嵌生成型)；保存时 D37 全量校验（失败拒绝+可用列表+LLM 重试）；验证无权/不存在引用被拒并提示
- [x] 2.4 生成型 Skill 连带审核（D46）：审核界面展示内嵌 Skill；approve 时落 skill_versions（published，submitter=Builder，reviewer=Admin，哈希锁定）入库；验证发布后其他草稿可按授权绑定（R-Q7）
- [x] 2.5 Skill 投稿与治理修复：投稿内容真实落盘（含文件/ZIP）、approve 发布投稿人内容、撤销记 revoked_by+审计、绑定授权校验入 createDraft/updateDraft、Admin 绑定授权界面；验证 AT-09 前后端到端
- [x] 2.6 Skill 生产加载接线：runProductionAgent 支持 skillsOverride（loadApprovedSkills 按快照 skillRefs + 哈希校验，D18 撤销语义）；验证绑定 Skill 的任务运行时其内容进入模型上下文
- [x] 2.7 脚本型 Skill 检测路由（W7）：注册/发布链路检测脚本特征；含脚本 Skill 生产执行必须 sandboxed（restricted 组合发布校验拒绝）；验证脚本仅在沙盒执行
- [x] 2.8 共享资料检索工具：resources.search 经 Gateway（ACL-first + 不可信内容包裹）；验证 AT-10 经 Agent 工具链端到端（未授权文档零泄露）
- [x] 2.9 HTTP API 工具执行器：http.* 服务端代理执行（参数 Schema 校验/凭证服务端注入/出网白名单/幂等键）；验证白名单外目标执行前被拒（AT-18）+ 端到端调用成功
- [x] 2.10 W10 显式写拒绝：共享资料写/删/外发操作服务端拒绝+留痕；验证拒绝事件含要素（用户/Agent/动作/资源/原因）
- [x] 2.11 waiting_input 生产可达：request_input 挂起工具（Gateway 白名单、payload 带 kind）+ 状态转 waiting_input（以工具事件为准）+ 释放并发槽/租约；验证大纲确认流真实发生（§3.2 场景端到端）
- [x] 2.12 continue 原生 resume：per-task sessionDir + SessionManager.open 恢复 + prompt(排队消息+回复)；验证 AT-13 沿用上下文与文件、运行中消息在恢复时投递（D35/D40）
- [x] 2.13 调度强化：执行期 lease 续租 + 长任务期间持续领取至并发上限；验证长任务不阻塞新任务领取、租约不误判 interrupted
- [x] 2.14 document-flow 渲染 + 上传 + 副本投递：apps/[slug] 双模板真实渲染（状态驱动四区块）、form-result 文件上传字段、任务输入文件副本进工作区（限授权文件）；验证方案应用多阶段页 + 上传文件进入模型可读输入（FR-07.3）

## 3. R3 沙盒真实现（FR-08）

- [x] 3.1 DockerBackend：docker CLI 实现 ExecutionBackend（默认 seccomp/cap-drop ALL/no-new-privileges/read-only/uid 65534/资源上限/仅挂任务 workspace）；修正 buildDockerRunArgs 非法值；验证容器安全参数审计断言（AT-16 前半）
- [x] 3.2 internal 网络与受控代理出网：compose internal 网络 + ControlledProxy 生产启动（Runner 进程）+ 容器注入代理地址/一次性 token + host 侧注 Key 按 Release 白名单转发；验证容器内无凭证可调模型、白名单外目标不可达（D36）
- [x] 3.3 Runner mode 分支接线：sandboxed 任务经 SandboxManager 容器执行（复用/新建）；无 sock 时 failed+结构化原因、restricted 不受影响；验证 sandboxed 不静默降级
- [x] 3.4 生命周期接线：空闲 15min sweep/退出 teardown/取消清理挂到调度循环；sessionDir 与成果在宿主持久卷；验证回收后 continue 可恢复（AT-14）与取消无残留
- [x] 3.5 部署面：compose runner 挂 rootless sock（env 可配）+ README Rootless 前置与降级说明；验证 macOS Docker Desktop 等价环境全链路可用（D10 策略）

## 4. R4 收尾（DoD 闭环）

- [x] 4.1 Studio/Admin UI 补全：撤回按钮、员工视角 Schema 预览（生产同款渲染器）、审核拒绝理由双端可见、per-user/部门授权界面、Hub 分类（Admin 指定+未分类区块+筛选）、文件在线预览、Studio 页面服务端角色拒绝（middleware/服务端重定向，AT-17 补全）；验证各 UI 场景手测清单 + 员工直访 /studio 被服务端阻断
- [x] 4.2 提审闸门真实执行：在线时 origin=test 执行草稿测试用例，离线附「未运行（离线演示模式）」；验证失败仍可提交且审核者可见结果（N5/D41）
- [x] 4.3 预算与成本：maxDurationSeconds 执行期强制、单价配置（resources 可选字段）与 estimated_cost、未配置单价降级注明、toolCalls 真实计数；验证超时长/超费用安全终止 + 未配置时事件注明（D44）
- [x] 4.4 可观测补全：拒绝操作数聚合、审计页 run.failed 查询 + action 过滤、runner 生产日志过 logJson/redact；验证管理员按任务查齐全字段且无秘密泄露
- [x] 4.5 幂等持久化：外部操作幂等记录持久存储（跨重启）；验证 Runner 重启后重试命中幂等不重复调用（§8.3）
- [x] 4.6 AT-20 冒烟自动化：scripts/smoke-compose.sh（mock OpenAI 兼容端点容器 + seed + 海报闭环断言 + 退出码）；验证脚本一键通过且日志标注 mock 边界（D47）
- [x] 4.7 真实性能实测：按 N10 接口清单在真实部署记录 P50/P95 + 5 并发真实任务基线；验证 performance-baseline.md 注明采集环境、无 mock 冒充（D31）
- [x] 4.8 文档如实化：decisions.md 修正沙盒描述、state.md 更新遗留、README 升级注记（N8）与能力边界如实；验证文档与代码行为一致抽查
- [x] 4.9 全量验收回归：148 既有测试全绿 + 新增回归全绿；AT-01~AT-20 逐条复验（映射缺口见 proposal）；验证 DoD 八条逐项核对留测试日志
- [x] 4.10 文件治理配置：类型白名单（默认非可执行类，见 personal-files spec）与配额上限服务端配置化、Admin 可调生效；验证白名单外类型被拒 + 调整后按新配置生效（personal-files「配额与类型限制」承载）

## Workflow follow-up

- 实现完成后由 openspec-verify-change 校验 artifacts 与实现一致性
- 满足审查要求后以 openspec-archive-change 归档本 change
