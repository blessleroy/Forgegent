# Tasks

## 1. M0 骨架：仓库与数据层

- [x] 1.1 搭建 pnpm monorepo（apps/web、apps/runner、packages/shared、packages/pi-adapter），配置 TypeScript/ESLint/测试框架；验证 `pnpm build && pnpm test` 全绿
- [x] 1.2 锁定 `@earendil-works/pi-coding-agent` 精确版本并写入 pi-adapter 占位封装；验证 lockfile 固化且 `import { createAgentSession }` 类型解析通过
- [x] 1.3 以 Drizzle 建 SQLite（WAL）schema：PRD §9 全表 + `departments`/`user_departments`（N3）+ `task_file_refs`（D23）+ `studio_conversations`（N4）+ `tasks.origin`；验证 migration 可重复执行且表结构测试通过
- [ ] 1.4 集成 Better Auth（登录/退出/会话过期/密码哈希、HttpOnly+SameSite Cookie、登录限流）；验证会话过期拒绝与暴力限流的集成测试
- [ ] 1.5 实现三角色与最小授权中间件（服务端角色判定）；验证"员工伪造 API 建 Agent → 403 + 审计留痕"测试
- [ ] 1.6 实现环境变量初始 Admin（空用户表时创建，首登强制改密）；验证对应集成测试
- [x] 1.7 实现本地文件存储层（上传/下载/删除/配额、路径穿越与符号链接防护、服务端 ACL）；验证单测覆盖 AT-08 攻击向量与配额拒绝
- [x] 1.8 建立结构化 JSON 日志 + audit_logs 写入（脱敏规则）；验证日志中不含明文密钥的断言测试

## 2. M0 骨架：Runner 最小会话

- [ ] 2.1 实现 Runner 进程骨架：SQLite 任务表轮询、`lease_until` 租约、并发上限 5（可配）、同 session 独占锁；验证双份重复领取与并发上限单测
- [ ] 2.2 在 pi-adapter 实现 restricted 会话工厂：`tools` 白名单 + `customTools` 注入点 + `SessionManager` 指向任务 workspace；验证白名单外工具不可用的单测
- [ ] 2.3 以 `ModelRuntime` 接入 OpenAI 兼容自部署端点（自定义 base URL，D11）；验证配置探活校验与错误信息
- [ ] 2.4 Docker Compose 骨架（web + runner + 数据卷）与 Dockerfile；验证 `docker compose up` 后健康检查通过
- [ ] 2.5 M0 验收场景：两个用户登录且文件相互隔离、一个手工定义的受限工具 Agent 安全运行；验证 E2E 脚本通过

## 3. M1 Agent Registry 与发布治理

- [ ] 3.1 实现 agents/agent_drafts/agent_releases 数据层与 API（slug 即时校验、agents 行随首草稿创建，D20）；验证 slug 冲突与草稿状态机（editing→in_review→rejected/approved、同 Agent 单一 in_review）单测
- [ ] 3.2 实现不可变发布快照（只读目录 + checksum，Task 绑定 release）；验证"发布 v2 时运行中 v1 任务继续旧快照"（AT-11）
- [ ] 3.3 实现审核/发布/下架/回滚 API 与 `/admin/agents` 页面（含导入/导出入口，N7）；验证 AT-03（未审核对员工不可见）与下架默认安全完成
- [ ] 3.4 实现发布范围授权（全体/成员/部门，默认未授权仅 Admin 可见，N1）；验证授权过滤测试

## 4. M1 任务闭环与员工 Hub

- [ ] 4.1 实现任务创建（校验使用权/资源权，记录 FR-06.1 全字段）与八态状态机（含完整合法迁移表与非法迁移拒绝）；验证状态转换单测覆盖每条迁移边
- [ ] 4.2 实现 task_events 事件源 + SSE 推送（脱敏过滤）+ 按事件 ID 补读；验证 SSE 断线重连补读且任务不重复执行的集成测试（PRD §10）
- [ ] 4.3 实现 continue 端点扩展（运行中 waiting_input 消息 + 四终态 continue 复用 task/session，D27/D17）与 cancel；验证 AT-13 与失败任务续跑测试
- [ ] 4.4 实现受控 UI Schema 渲染器与 `form-result` 模板（字段类型/必填校验/文件上传，D24）；验证组件测试覆盖字段渲染与校验
- [ ] 4.5 实现海报 Tool：OpenAI 兼容 images 端点（管理员配置，D16）+ 结果校验 + 幂等键；验证幂等重试不重复调用的单测
- [ ] 4.6 实现 Hub（授权过滤清单/搜索/分类 N2）、`/apps/:slug`、`/tasks`、`/files` 页面与平台 UI 双语 i18n（D12/D15）；验证语言切换 E2E 与 Hub 仅显示授权应用
- [ ] 4.7 实现后台执行语义：页面关闭不影响 Runner 执行、重开可查进度成果；验证 AT-12 E2E 通过
- [ ] 4.8 实现 seed 脚本（演示账号 + 已发布示例海报 Agent，D25）与 README 快速开始；验证 AT-04（员工生成/预览/下载海报）E2E 通过

## 5. M1 Tool Gateway 与权限执行

- [ ] 5.1 实现权限交集引擎（用户 ∩ Release ∩ Task，默认拒绝）与拒绝审计；验证交集计算与留痕单测
- [ ] 5.2 实现 Tool Gateway 逐调用校验（用户/Agent/Task/动作/资源/参数 + 出网白名单）；验证 AT-05（Shell/财务资料被拒）与 AT-18（伪造参数执行前拦截）
- [ ] 5.3 验证伪造配置变更（AT-06）：员工改模型/Skill/Tool 的 API 一律 403 且生产配置不变的回归测试

## 6. M2 Studio 闭环（V1 核心）

- [ ] 6.1 实现 Builder Agent 对话服务（studio_conversations 持久化，N4）：自然语言 → 结构化需求清单 + 待补信息 + 拟生成组成；验证 AT-01（生成含 Prompt/Skill/UI Schema/工具绑定/测试用例的草稿）。M2 过渡：Builder Agent 以 restricted 模式运行（design D11），M3 由 7.x 切沙盒
- [ ] 6.2 实现对话修改草稿（作用当前草稿 + 差异展示）；验证 AT-02（修改同步草稿与预览、不影响已发布版本）
- [ ] 6.3 实现员工视角预览与隔离测试运行（origin=test，仅 Studio 可见，测试资源限 Admin 授权范围）；验证 Builder 测试任务不进员工 /tasks
- [ ] 6.4 实现提审/撤回/复制发布版本成新草稿（D19/D20）与提审自动测试闸门（N5：失败仍可提交、结果附审核者）；验证非属主操作被拒与闸门行为测试
- [ ] 6.5 实现 `document-flow` 模板（资料上传→大纲确认→进度→下载，D24）；验证组件测试与 AT-17（无 Builder 角色者 Studio 页面与 API 均拒绝）
- [ ] 6.6 M2 验收 E2E：不经手工改代码，Builder 从自然语言创建新 Agent → 审核 → 发布 → 员工使用；验证完整链路脚本通过

## 7. M3 沙盒与执行隔离

- [ ] 7.1 实现执行后端接口抽象（默认 Rootless Docker，可替换）；验证接口契约单测
- [ ] 7.2 实现按会话容器生命周期（按需启动/多轮复用/空闲 15 分钟回收/回收前持久化）；验证复用与回收行为测试
- [ ] 7.3 落实容器安全约束（非特权/最小 capabilities/seccomp/资源上限/出网白名单/禁挂 Docker Socket 与生产密钥）；验证 AT-16（脚本仅沙盒可测、宿主不可达）
- [ ] 7.4 实现沙盒受控代理通道（模型代理 + 文件 API，容器无生产凭证，spec"沙盒受控代理通道"）；验证容器内模型调用经代理且文件系统无 Key 的测试
- [ ] 7.5 实现崩溃恢复：Runner 重启将未完成任务标 `interrupted`、沙盒回收后 continue 可恢复 Session 与文件；验证 AT-14/AT-15（绝不悄然标成功）
- [ ] 7.6 实现取消/超时/超预算清理（容器与临时文件清理、成果与审计保留、failed+结构化原因 N6；waiting 挂起不计最大时长）；验证清理与超限终止测试

## 8. M3 Skill Registry 与资源治理

- [ ] 8.1 实现 Skill 版本注册（SKILL.md+文件、版本+内容哈希）与员工投稿待审核；验证 AT-09 前半（未审核不进生产）
- [ ] 8.2 实现 Admin 审核发布撤销（留审核人与结论；撤销仅阻断新绑定，D18）与 Builder 授权绑定锁版本；验证 AT-09 后半与撤销不熔断存量测试
- [ ] 8.3 实现 `skillsOverride` 生产 ResourceLoader（仅加载发布快照内已审核 Skill + 哈希校验）；验证加载器单测
- [ ] 8.4 实现企业公共只读资料资源：Admin 授予员工 ACL、检索先过滤后返回；验证 AT-10（按员工 ACL 过滤不泄露）
- [ ] 8.5 实现受控 HTTP API 工具声明式配置（端点/方法/参数 JSON Schema/鉴权，凭证服务端，出网白名单随 Release，D26）；验证配置校验与白名单拦截测试
- [ ] 8.6 实现方案生成专家示例（document-flow：上传客户需求 → 授权资料检索 → 大纲确认 → DOCX 产出）；验证 M3 验收（方案 Agent 仅用授权资料、输出 DOCX、文件隔离）

## 9. V1 收尾与验收

- [ ] 9.1 实现应用包导出/导入脱敏（去密钥/私有资源/内部身份；导入为草稿，N7）；验证导出包不含敏感材料、导入后须重新授权审核
- [ ] 9.2 实现用户停用生命周期（D22：拒登录/拒新任务/运行中安全完成/Agent 冻结 Admin 可代管/文件审计保留）；验证停用边界测试
- [ ] 9.3 编写备份/恢复操作说明并验证 AT-19（恢复到测试环境后账号/版本/文件元数据与内容一致）
- [ ] 9.4 完善 README 与 Compose 部署文档（含 Rootless 前置、环境变量、模型端点配置、seed）；验证 AT-20（全新 Linux 服务器部署即跑示例闭环）
- [ ] 9.5 建立安全回归套件：越权/路径穿越/提示词注入/恶意 Skill/凭证泄露五大类；验证套件全绿
- [ ] 9.6 建立 E2E 主链路测试（Builder→审核→发布→员工交付，覆盖 AT-01~AT-20）与性能基线记录（5 并发、P50/P95）；验证完整套件通过并留测试日志

## Workflow follow-up

- 实现完成后由 openspec-verify-change 校验 artifacts 与实现一致性
- 满足审查要求后以 openspec-archive-change 归档本 change
