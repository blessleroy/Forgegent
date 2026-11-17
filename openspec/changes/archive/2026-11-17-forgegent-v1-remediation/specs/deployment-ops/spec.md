# deployment-ops Delta

## MODIFIED Requirements

### Requirement: Docker Compose 单机部署

单机 Docker Compose SHALL 仅包含 Web + Runner + 共享数据卷（无 Redis/S3/MQ）；启用沙盒能力时 Runner MUST 可访问 Rootless Docker socket（控制平面访问，文档写明 Rootless 前置）并接入 internal 沙盒网络；未启用沙盒的部署 MUST 仍可运行 restricted 任务（降级路径见 sandbox-isolation）。部署文档 MUST 如实描述当前能力边界（MUST NOT 声称未实现的能力）。

#### Scenario: 全新服务器可部署（AT-20 前半）

- **WHEN** 按 README 在全新 Linux 服务器执行 Compose 部署（含 Rootless 前置）
- **THEN** Web 与 Runner 健康检查通过，restricted 示例任务可执行，沙盒按配置可用或明确降级

### Requirement: 性能与可用性基线

V1 验收基线 MUST 为：支持 5 个并发运行任务（上限可配置），用户任务/会话/文件严格隔离；核心接口 MUST 记录 P50/P95（不将 LLM 等待计入 Web 慢）；沙盒 MUST 预装镜像、无每任务拉镜像；同一会话连续修改 MUST 复用沙盒。并发隔离与性能基线 MUST 基于真实部署实测记录：至少对核心接口清单（`GET /api/agents`、`GET /api/tasks`、`GET /api/files`、`GET /api/tasks/:id/events` SSE 首连，N10）记录 P50/P95，并记录 5 并发真实任务的行为基线；mock 数据 MUST NOT 冒充实测（基线文件中明确标注数据来源）。

#### Scenario: 并发隔离达标（AT-07）

- **WHEN** 5 个任务并发运行
- **THEN** 全部完成且相互隔离，无串数据或串会话

#### Scenario: 性能实测记录入仓

- **WHEN** 本 change 收尾时检查 `test-results/performance-baseline.md`
- **THEN** 其中的 Web 接口 P50/P95 来自真实部署实测且注明采集环境，mock 来源数据（如有）明确标注为 mock

### Requirement: seed 示例闭环

seed SHALL 保持幂等预置（演示账号 + 已发布示例海报 Agent + 模型端点资源）；seed 产物 MUST 与产物存储统一后的路径约定一致。

#### Scenario: 开箱示例闭环（AT-20 后半）

- **WHEN** `FORGEENT_SEED_DEMO=1` 启动并配置模型端点（`FORGEENT_SEED_DEMO` 为既有代码变量名，沿用不改）
- **THEN** 演示员工可完成生成、预览与下载的完整闭环（下载路径为统一存储根）

## ADDED Requirements

### Requirement: AT-20 部署冒烟自动化

平台 SHALL 提供 Compose 冒烟自动化脚本：一键构建镜像并启动（含内置 mock OpenAI 兼容端点容器充当模型端点，D47）→ 等待健康 → seed → 以演示员工跑通海报任务创建、执行、产物下载断言；脚本 MUST 可重复执行且退出码反映成败；测试日志 MUST 标注其中模型端点为 mock（部署接线考察，真实性由真实部署实测承担）。

#### Scenario: 冒烟脚本一键通过

- **WHEN** CI/本地执行冒烟脚本
- **THEN** 全链路断言通过、脚本退出码 0；中断时退出码非 0 并输出失败环节

### Requirement: 升级与数据位置说明

README MUST 提供升级注记：本 change 统一产物存储根后，历史开发环境 `data/runner/files` 下的文件可手动并入 `data/files` 或直接清空（预发布数据，无自动迁移脚本，N8）；旧任务的 `interrupted` 状态在新恢复机制下 continue 失败时以 `failed`+结构化原因呈现（N6 同构）。

#### Scenario: 升级注记可循

- **WHEN** 运维按 README 升级注记处理旧数据目录
- **THEN** 升级后新任务产物下载正常，旧数据处理方式明确无歧义
