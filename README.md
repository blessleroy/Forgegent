# Forgegent（智体工坊）

**Build Agents. Ship Applications.** — 通过自然语言构建、审核、发布和运行专业 Agent 应用的开源友好企业平台。

由少数授权人员（Builder）"用 Agent 制造应用"，多数员工"像使用 Web 软件一样使用已发布应用"。

## 架构（单机轻量）

```
Next.js Web（UI/API/认证/权限） ── SQLite(WAL) + 本地文件 ── Node.js Runner（任务执行）
                                                        └── 按需沙盒（Rootless Docker）
```

- **无** Redis / MQ / S3 / Keycloak / Kubernetes —— 单机 Docker Compose 即可运行
- Agent 内核：[`@earendil-works/pi-coding-agent`](https://pi.dev) SDK（版本锁定）
- 完整规格：`openspec/`（spec-driven，`forgegent-v1-platform` change）

## 快速开始（Docker Compose）

### 前置要求

- Linux 服务器（Ubuntu 22.04+ / Debian 12）+ **Rootless Docker**（[官方安装指南](https://docs.docker.com/engine/security/rootless/)；本机开发用 Docker Desktop 等价验证）
- 2 vCPU / 2GB 内存起

### 1. 部署

```bash
git clone https://github.com/<you>/forgegent.git && cd forgegent

export FORGEGENT_ADMIN_EMAIL=admin@yourcorp.local
export FORGEGENT_ADMIN_PASSWORD='change-me-immediately'
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"

docker compose up -d --wait
```

首个 Admin 由环境变量创建，**首次登录强制改密**。

### 2. 配置模型端点（OpenAI 兼容自部署/中转）

管理员登录后进入 `/admin/agents`，或直接以环境变量注入：

```bash
export FORGEGENT_MODEL_BASE_URL='https://your-gateway.local/v1'   # OpenAI 兼容（含 images）
export FORGEGENT_MODEL_NAME='gpt-image-1'
export FORGEGENT_MODEL_API_KEY='sk-...'        # 仅存服务端环境，不落库
docker compose up -d
```

配置保存时自动探活校验（连通性 + 鉴权 + 模型列表）。

### 3. 运行示例闭环（AT-20）

```bash
export FORGEGENT_SEED_DEMO=1
docker compose up -d --wait
```

seed 会创建：演示账号 `builder@forgegent.local / demo-builder-123`、`employee@forgegent.local / demo-employee-123`，以及一个**已发布**的「海报设计师」示例应用。

用演示 Employee 登录 → Hub 打开「海报设计师」→ 输入主题与风格 → 提交任务 → 在 `/tasks` 查看进度与成果 → 下载海报。**闭环完成。**

## 沙盒能力（可选启用）

`sandboxed` 模式的 Agent（含脚本的 Skill、需要执行命令的任务）通过独立的 Rootless Docker 容器执行不可信命令：

```bash
# 1) 预构建沙盒镜像（严禁每任务拉镜像）
docker build --target sandbox-base -t forgegent-sandbox:1 .

# 2) 让 runner 访问 Rootless Docker daemon（控制平面访问；沙盒容器自身
#    永远不会挂载 docker socket），然后启动
export FORGEGENT_DOCKER_SOCKET=/run/user/$(id -u)/docker.sock   # rootless sock 路径
docker compose up -d --wait
```

沙盒拓扑：容器接入 **internal 网络**（无外网出口），唯一可达出口是 runner 进程内的**受控代理**（按 Release 出网白名单转发；生产模型 Key 仅在宿主侧注入）。容器非 root、cap-drop ALL、只读 rootfs、内存/CPU/pids 上限、任务工作区以挂载方式可见。

**未启用时的降级行为**：不挂载 docker socket / daemon 不可达时，`restricted` 任务照常运行，`sandboxed` 任务以结构化原因失败（不会静默降级为宿主执行）。相关环境变量：`FORGEGENT_SANDBOX_IMAGE`、`FORGEGENT_SANDBOX_NETWORK`、`FORGEGENT_PROXY_PORT`、`FORGEGENT_SANDBOX_PROXY_URL`。

## 升级注记

- 本版本统一了产物存储根（runner 与 web 同用 `<dataDir>/files`）：升级前旧开发环境的 `data/runner/files` 可手动并入 `data/files` 或直接清空（预发布数据，无自动迁移脚本）。
- 旧 `interrupted` 任务在新恢复机制下 continue 失败时将转为 `failed` 并附结构化原因。

## 常用运维

| 操作 | 说明 |
|---|---|
| 备份/恢复 | 见 [`docs/backup-restore.md`](docs/backup-restore.md)（AT-19 一致性快照） |
| 并发上限 | `FORGEGENT_MAX_CONCURRENCY`（默认 5） |
| 数据目录 | `FORGEGENT_DATA_DIR`（默认 `data/`，卷挂载 `/data`） |
| 部署冒烟 | `bash scripts/smoke-compose.sh`（AT-20 闭环，内置 mock 模型端点，D47） |
| 性能实测 | `node scripts/perf-measure.mjs`（N10 接口 P50/P95；基线见 `test-results/performance-baseline.md`） |

## 开发

```bash
pnpm install
pnpm build && pnpm test     # 全部包构建 + 测试
pnpm dev:web                # Next.js 开发服务器
pnpm dev:runner             # Runner（轮询任务队列）
```

monorepo：`apps/web`、`apps/runner`、`packages/{shared,pi-adapter,db,storage,registry,tasks,studio,gateway,skills,sandbox}`。

## 安全模型（摘要）

- 有效权限 = **用户 ∩ Agent 发布版本 ∩ 任务**，默认拒绝，Tool Gateway 逐调用校验
- 未审核 Skill 不进生产；发布产物不可变（checksum 固定）；回滚切指针
- 沙盒：非特权容器、cap-drop ALL、出网白名单、**生产密钥仅在宿主侧代理**
- 全量审计（拒绝/发布/敏感操作），日志脱敏

详见 `openspec/changes/forgegent-v1-platform/`（12 个 capability 规格）。

## License

Apache-2.0
