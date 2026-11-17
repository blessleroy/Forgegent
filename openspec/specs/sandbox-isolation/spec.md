# sandbox-isolation Specification

## Purpose
代码执行隔离：restricted（白名单工具、常驻 Runner）与 sandboxed（Docker Rootless 按会话容器）两种运行模式的边界、容器安全约束、不可信构建隔离与生命周期清理。

## Requirements

### Requirement: restricted 受限工具模式

`restricted` 模式 SHALL 仅加载平台可信、已审核的调用型 Tools；MUST 禁用 Shell、任意代码执行、自由文件系统访问与未授权 Extension；Session 之间 MUST 隔离，工具端检查 MUST 仍然存在。

#### Scenario: 受限模式禁 Shell（AT-05 支撑）
- **WHEN** 员工要求一个 `restricted` 模式的海报 Agent 执行 Shell 命令
- **THEN** 该工具调用在执行层被拒绝并留痕

#### Scenario: 文件读取受限
- **WHEN** `restricted` 模式的 Agent 尝试读取白名单之外的任意路径
- **THEN** 访问被工具端拒绝

### Requirement: sandboxed 沙盒模式强制场景

不可信执行体（动态代码执行/依赖安装/第三方脚本的业务 Agent、脚本型 Skill、草稿测试中的脚本执行）MUST 在独立沙盒内执行；每工作会话一个容器，按需启动、多轮复用、空闲 15 分钟回收，回收前 MUST 持久化必要数据。执行拓扑与降级规则见下方场景（D38/D36）。

#### Scenario: Builder 脚本仅沙盒可测（AT-16）

- **WHEN** Builder 创建含可执行脚本的 Skill 并测试
- **THEN** 脚本仅在构建沙盒内运行，无法访问宿主机密钥或 Docker Socket

#### Scenario: 会话容器复用与回收

- **WHEN** 同一工作会话连续多轮修改后闲置超过 15 分钟
- **THEN** 前几轮复用同一容器，闲置超时后容器被回收且必要数据已持久化

#### Scenario: sandboxed 任务不静默降级

- **WHEN** 一个 `mode=sandboxed` 的任务被调度执行
- **THEN** 它在沙盒容器内执行；若沙盒后端不可用，任务以结构化原因进入 `failed`，而非在宿主以 restricted 方式运行

### Requirement: 容器安全约束

沙盒 MUST 默认非特权、最小 capabilities、启用 seccomp（Docker 默认 profile，MUST NOT 使用非法/自定义未审计值）、施加资源上限（内存/CPU/pids）并限制出网；MUST NOT 挂载 Docker Socket、生产密钥或整个用户目录；沙盒默认 MUST NOT 访问管理 API、数据库、本机元数据接口与企业内部敏感网段。出网限制 MUST 通过网络拓扑真实生效：沙盒容器接入无外网出口的 internal 网络，唯一可达路径为平台受控代理（按 Release 出网白名单转发）；MUST NOT 以仅添加 DNS 记录的方式充当出网过滤。

#### Scenario: 沙盒访问管理 API 被拒

- **WHEN** 沙盒内进程尝试访问平台管理 API 或宿主元数据接口
- **THEN** 网络策略阻断该访问

#### Scenario: 出网仅达白名单目标

- **WHEN** 沙盒内进程尝试访问 Release 出网白名单之外的外部地址
- **THEN** 请求无法离开 internal 网络（唯一出口代理拒绝转发），访问失败并留痕

### Requirement: 不可信代码构建隔离

不可信脚本与生成前端代码的构建/测试 MUST 在沙盒内进行，且 MUST NOT 获得宿主机或管理 API 的宽泛访问权。

#### Scenario: 生成代码构建不出沙盒
- **WHEN** 平台对 Agent 生成的前端代码执行构建与测试
- **THEN** 构建过程完全在沙盒内完成，宿主文件系统与凭证不可触及

### Requirement: 沙盒受控代理通道

沙盒容器内的不可信进程（脚本/命令/构建等沙盒执行体）MUST 通过平台受控代理访问外部能力：外部调用（模型/HTTP）经服务端受控代理（凭证不出服务端，按 Release 出网白名单转发），文件读写经受控文件接口（仅限该任务已授权文件）；容器 MUST NOT 直接持有任何生产凭证或直连外部端点。受控代理 MUST 在生产 Runner 中真实启动（监听 internal 网络接口），Runner 创建沙盒容器时 MUST 注入代理地址与短期一次性 token；真实生产 API Key 仅在 Runner/代理侧存在。Pi 编排循环运行于宿主 Runner（与 restricted 同构、受同一 Tool Gateway 管控），其自身模型调用走既有服务端 ModelRuntime，不经容器网络（进程拓扑见 design.md，D36/D38）。

#### Scenario: 容器内无凭证可模型调用

- **WHEN** 沙盒内进程（脚本型 Skill 的脚本、构建命令等）发起模型或 HTTP 外部请求
- **THEN** 请求经平台受控代理完成（白名单内放行、白名单外拒绝），容器文件系统与环境变量中不存在任何生产 API Key

#### Scenario: 代理白名单随 Release

- **WHEN** 沙盒内请求的目标不在该 Release 的出网白名单中
- **THEN** 受控代理拒绝转发并记录拒绝事件

### Requirement: 执行环境可替换

执行环境 SHALL 通过接口抽象支持未来替换为 gVisor/MicroVM；V1 MUST NOT 实现容器预热池（除非性能测试明确需要）。

#### Scenario: 运行时适配可替换
- **WHEN** 部署方为强隔离需求替换执行后端
- **THEN** 仅需实现执行环境接口，平台其余行为不变

### Requirement: 生命周期清理

容器退出、空闲回收、用户取消与进程崩溃 MUST 触发临时文件与容器清理；审计记录与持久成果 MUST 保留。清理与空闲回收逻辑 MUST 在生产 Runner 中接线（周期回收扫描与退出清理真实执行，而非仅存在于库层）。

#### Scenario: 取消后无残留

- **WHEN** 用户取消一个使用沙盒的任务
- **THEN** 该任务容器与临时文件被清理，成果与审计事件保留

#### Scenario: 回收后恢复（AT-14 支撑）

- **WHEN** 沙盒因空闲被回收后员工对任务继续修改
- **THEN** 系统基于宿主持久卷中的会话与授权文件恢复执行，且不读取其他用户数据
