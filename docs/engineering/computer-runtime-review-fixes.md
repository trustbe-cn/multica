# Computer 与运行时 review 修复记录

记录日期：2026-09-24。最终代码提交：[`e8d97ddc8`](https://github.com/trustbe-cn/multica/commit/e8d97ddc889f95390d1538d7a46447983ba76007)，`fix(admin): harden per-user runtime installation and provisioning`。

该提交合并了对 `3b959bb94`、`72cfe0b39` 及第一轮修复的两轮 review 反馈。本文记录当时的实现和验证证据；Admin runtime 入口与接口后来已迁移，当前契约见[Linux User 与运行时管理归属](../design/linux-user-runtime-management.md)。概念、权限和生命周期见[设计文档](../design/computer-runtime-identity-model.md)。

## 1. 问题范围

原功能通过 Admin Area 列出 Computer 上的 CLI 版本，并支持通过 SSH 为指定 Linux 用户安装；同时为新账号初始化 zsh、htop、curl、git 和 oh-my-zsh。

第一轮发现安装权限、npm prefix、探测用户、下载安装错误传播、账号初始化与 UI 数据管理问题。补充 review 进一步指出厂商安装目录、Oh-My-Pi 的 Bun 依赖、版本固定能力和界面回归。问题横跨三条链路：

1. 管理员选择 Linux 用户 → 安装 CLI → `--version` 验证。
2. systemd daemon → 发现 CLI → 向指定工作区注册运行时。
3. 开通用户 → 安装工具 → 写凭据 → 启动 daemon → 确认注册成功。

HTTP 健康检查、脚本退出码、CLI 安装完成与运行时在线是不同的成功信号。

## 2. Review 结论核实

| 结论 | 核实结果 | 最终处理或边界 |
| --- | --- | --- |
| 版本字符串可通过换行注入命令 | 不成立。原版本正则为 `^[0-9A-Za-z.\-+]+$`，不接受换行。 | 保留白名单，并增加非法版本/用户名测试。 |
| `sudo curl … \| runuser …` 只提升管道左侧权限 | 成立。普通 SSH operator 无法以这种方式运行右侧 `runuser`。 | 整个安装脚本在 `sudo -n runuser -u <user> -- sh -c ...` 下执行。 |
| 普通用户 `npm install -g` 会写不可写的全局 prefix | 成立。切换用户不会自动创建私有 prefix。 | 同时设置 `NPM_CONFIG_PREFIX` 和 `--prefix` 指向 `$HOME/.local`，检查 Node/npm 前置条件。 |
| Oh-My-Pi 原 npm 包名 `omp` 不正确 | 成立。上游包为 `@oh-my-pi/pi-coding-agent`。 | 第一轮修正包名；补充 review 后最终改用官方独立二进制安装，见下文。 |
| Oh-My-Pi npm 入口要求 Bun | 成立。核对的上游 npm 元数据声明 `bun >= 1.3.14`，仅有 Node/npm 不足。 | 官方安装器使用 `--binary`，固定安装目录和 release tag，不依赖另装 Bun。 |
| Kimi 默认目录不在安装检查/daemon PATH | 成立。读取的官方脚本默认使用 `$HOME/.kimi-code/bin`。 | 安装时固定该目录，并将其加入安装、探测和 daemon 的 PATH。 |
| Grok 原生目录和固定版本能力未处理 | PATH 缺少 `~/.grok/bin` 可由代码确认；上游脚本和文档在核实时连接超时。 | 补齐路径并预建 `~/.local/bin`；版本按 review 提供的位置参数约定传入。上游契约尚未独立验证。 |
| 安装使用目标用户，探测使用 SSH operator | 成立。用户私有安装不可用机器级单一版本准确表达。 | GET 接受 `linux_user`，新 UI 始终按目标用户查询；旧请求省略该参数时保留 operator 语义。 |
| curl 失败可能被当作安装成功 | 成立。管道或命令替换可能掩盖下载退出码。 | 先下载到临时文件，成功后才执行；安装后再检查 CLI。oh-my-zsh 同样改为完整下载后执行。 |
| Grok/Kimi 只能装 latest | 第一轮修复中的结论不准确。Kimi 官方脚本明确支持 `KIMI_VERSION`/`--version`；Grok 的参数约定还缺独立证据。 | Kimi 支持固定版本；Grok 已传位置参数但保留验证缺口。不能把二者继续统一描述成 latest-only。 |
| 失败时丢掉远端输出 | 成立。输出已收集，但错误路径没有附带诊断。 | 对已知敏感值脱敏后，保留最多约 4 KB 尾部诊断，保留原错误链。 |
| 串行探测可能累计等待多个 SSH 超时 | 成立。 | 对当前七个 descriptor 并行探测，每项 30 秒，并传播请求取消；不再按七次串行累加。 |
| 先使用未安装的 zsh 建号，且 90 秒外层预算不足 | 成立。 | apt 移至 `useradd` 前；建号操作独立提高 SSH 预算，最终为至少 8 分钟。 |
| apt 超时只杀父进程，可能留下 dpkg 子进程 | 成立。 | apt 与 oh-my-zsh 都置于独立进程组，超时先 SIGTERM，再 SIGKILL 清理残留。 |
| 6 分钟预算必然导致超时 | 证据不足。两个 120 秒安装器加账号操作仍有余量，但清理预算偏紧。 | 最终增加到 8 分钟；不把风险描述成必然故障。 |
| 所有 Linux 发行版都能通过检查，但创建时要求 apt-get | 成立。 | 连接检查要求 `apt-get`，文档明确当前按 Debian/Ubuntu 支持，不再暗示通用发行版安装能力。 |
| apt 失败后会删除刚创建的账号 | 对最终顺序不成立。apt 时尚未执行 `useradd`。 | 只有账号创建后的初始化失败才进入账号删除补偿；后续外层失败另有新账号补偿。 |
| 可选工具失败会阻断整个开通 | 事实成立，当前行为保留。 | 显式记录为当前开通契约；未实现增强工具异步重试或失败忽略。 |
| `.pub` 缺失时没有公钥推导 | 成立。 | 文件不存在时用有 5 秒预算的 `ssh-keygen -y` 推导；其他读取错误不被掩盖。 |
| UI 未走 Query、错误为空白、所有行一起 Installing | 成立，其中共享 mutation 是第一轮修复引入的回归。 | 使用 Query；每行独立 mutation/错误；安装结束刷新管理数据和审计。 |
| 输入框都叫 Version，前置条件和失败文案误导 | 成立。 | 输入框名称包含 runtime；明确路径与 nvm 限制；分开版本失败、列表格式错误和空列表。 |
| `VersionRequired` 零值变成 latest-only | 是易出错的扩展默认值，不代表已有每个 descriptor 都配置错误。 | 内部改为 `LatestOnly` 显式 opt-in；对外保留 `version_required`，零值对应要求版本。 |
| HTTPS 下载脚本仍存在供应链信任 | 成立，尚未消除。 | 完整下载再执行能处理传输失败，不等同于固定校验和、签名验证或可信脚本版本锁定。 |

## 3. 最终实现

### 3.1 安装与发现环境

安装脚本通过 `runuser` 进入目标用户，切换到其 home，创建 `~/.local/bin`。安装和探测的 PATH 为：

```text
$HOME/.local/bin:$HOME/.kimi-code/bin:$HOME/.grok/bin:/usr/local/bin:/usr/bin:/bin
```

daemon unit 包含相同的用户目录，另保留系统 sbin 路径；生成时会替换为实际账号 home。它不会读取 `.zshrc`。修改 unit 模板不会自动更新已有远端 unit。

| 安装类型 | 关键行为 |
| --- | --- |
| Claude、Codex、OpenCode、Pi | 系统可见的 Node/npm；用户私有 prefix；npm 包名和请求版本组合后安装。 |
| Oh-My-Pi | 官方安装脚本先完整下载；`PI_INSTALL_DIR=$HOME/.local/bin`；`--binary`；`1.2.3`/`v1.2.3` 规范为 release tag `v1.2.3`；`latest` 不指定 ref。 |
| Kimi | `KIMI_INSTALL_DIR=$HOME/.kimi-code`；清空继承的 `KIMI_VERSION`；固定版本用 `--version`；`latest` 由安装器解析。 |
| Grok | 版本传给安装器的第一个位置参数；`~/.grok/bin` 纳入 PATH；仍需核对真实上游脚本。 |

安装后执行 CLI `--version`，防止安装器以 0 退出但缺少可执行文件时误报成功。这一检查验证可运行性，没有通用地比对输出是否等于请求版本，也不证明模型调用或厂商认证可用。

运行时身份与协议族保持分离：Oh-My-Pi 作为 `omp` 身份复用 `pi` 协议；新增安装 descriptor 不改变协议工厂。

### 3.2 API、诊断与审计

- `linux_user` 校验通过后，GET 版本探测使用与安装一致的账号和 PATH。查不到命令返回空版本；命令存在但 `--version` 失败返回 `probe_error`，不统一归因于 SSH/账号问题。
- 默认要求 `version`，仍受字符白名单约束。只有 descriptor 显式 `LatestOnly=true` 时，才接受省略版本或 `latest`、拒绝固定版本。最终内置七项均未开启 `LatestOnly`。
- 响应新增的 `version_required`、`probe_error` 在客户端分别默认成 `true`、空字符串，兼容旧服务端响应。
- 检查接口经过 `parseWithFallback`，格式错误时退为未通过检查。运行时列表格式错误通过空哨兵结果转为可见错误，不再伪装成“没有记录”。
- SSH 命令失败时返回经过已知 secret 脱敏和长度限制的诊断；保留底层错误，PAM 密码不匹配等分类仍可工作。该脱敏不保证识别任意第三方输出中的未知 secret。
- 安装 SSH 使用请求 context；请求取消时终止本地 SSH 等待。远端任意安装脚本及其所有后代是否终止不能只靠这个机制保证。
- 审计写入改用从请求脱离的 5 秒 context，记录 `runtime_install:<runtime>@<requested-version>`。当前忽略审计写入错误，尚无持久重试，也未存实际解析版本或目标用户名。

### 3.3 账号初始化

| 范围 | 当前预算/行为 |
| --- | --- |
| SSH 建连 | `ConnectTimeout=10` 秒。 |
| 普通 SSH 操作 | 未指定时 90 秒。 |
| Computer 连接检查 | SSH 45 秒；检查本身为只读。 |
| 单项 CLI 版本探测 | SSH 30 秒，各项并行。 |
| CLI 安装 | SSH 5 分钟，受请求取消影响。 |
| 顶层安装脚本下载 | curl 建连 10 秒、下载最长 60 秒；不等同于安装器内部所有下载的总预算。 |
| 新账号创建 | SSH 至少 8 分钟，覆盖两个安装器、账号操作和清理余量。 |
| apt / oh-my-zsh | 各等待 120 秒；异常清理给 SIGTERM 后等待 10 秒，再清理进程组并等待 5 秒。 |
| 运行时就绪检查 | 后台操作完成后最多等 90 秒，检查指定用户/工作区/daemon 的新鲜心跳。 |
| 审计与公钥推导 | 分别 5 秒。 |

账号开通后台作业与管理员 CLI 安装不同：开通接口先返回 202，再异步执行。其数据库操作和就绪等待使用 15 分钟后台 context，但没有将同一 context 贯穿所有旧式 SSH 子操作，不能描述成严格统一的端到端取消预算。

账号创建脚本处理 SIGHUP/SIGTERM，尽力进入回滚；apt 放在账号创建前。外层 `Apply` 仅在确认新账号创建成功后，才对后续失败补偿删除。进程崩溃、断电或删除账号失败仍需人工确认。

### 3.4 当时的界面与缓存（现已迁移）

- 运行时查询键为 `["computer-admin", userId, "runtimes", computerId, linuxUser]`；请求可取消，用户名输入延迟 400 ms 后查询。
- 每行使用独立 `useAdminRuntimeInstall`。一行安装中不会把其他行也显示为 Installing；任何安装未结束时锁定 Linux 用户输入，防止误切用户。
- 每行保留自己的版本草稿和错误；版本框的 accessible name 包含运行时名称。
- 安装成功或失败后均使账号级管理查询失效，刷新版本和审计。输入草稿属于本地 UI 状态，服务端列表属于 Query。
- 提示明确 Node/npm 的系统目录和不读取 nvm；Oh-My-Pi 使用独立二进制。补齐 en、fr、ja、ko、zh-Hans 文案。

## 4. 回归测试与验证证据

以下为代码修复期间实际执行的结果，不能替代后续环境的复验；本次整理文档不重新执行代码测试。

| 验证 | 结果与边界 |
| --- | --- |
| `go test ./internal/computer -count=1`（在 `server/` 下） | 通过。包含账号初始化失败、超时、密码补偿、Python 脚本语法、诊断脱敏与 PATH 检查。 |
| agent 安装专项测试 | 通过。覆盖真实 descriptor 生成的 shell 命令，外部程序全部使用测试桩。 |
| `go test ./pkg/agent -count=1` | 第一轮最后一次全包运行通过；最终补充修复后执行的是安装专项测试。更早曾有不稳定运行，不能声称所有历史执行均通过。 |
| 管理员页面测试 | 最终 14/14 通过，包括独立安装状态、并发安装时账号锁定、错误定位及版本 accessible name。 |
| API 客户端测试 | 122/122 通过，含旧响应默认值及 malformed-response 用例。 |
| core 类型检查 | 通过。 |
| `pnpm lint` | 通过，存在仓库已有 warning。 |
| `git diff --check` | 通过。 |
| 数据库 handler 测试 | 编译成功；执行因本地 PostgreSQL 认证失败被 `TestMain` 跳过。退出码 0 不能当作测试执行成功。 |
| views/全仓类型检查 | 受到既有 `@multica/plugin-sdk`、`@multica/plugin-sdk/protocol`、`remark-cjk-friendly/parseOnly` 缺失影响。最终 views 检查未报告本轮文件的类型错误，但整体检查未通过。 |
| 全仓前端测试 | 第一轮在 UI Lab 缺少 `colorjs.io` 时中止；未声称全仓测试通过。 |
| 真实 CLI、远端建号、浏览器 E2E | 未执行。没有用生产数据库运行测试。 |

可重复执行的专项命令：

```sh
cd server
go test ./internal/computer -count=1
go test ./pkg/agent -run 'TestAdminInstallDescriptorsUseTargetUserEnvironment|TestRuntimeInstallCommands' -count=1
```

从仓库根目录执行前端专项测试：

```sh
pnpm --filter @multica/core exec vitest run api/client.test.ts
pnpm --filter @multica/views exec vitest run admin/admin-page.test.tsx
pnpm --filter @multica/core typecheck
```

新增安装测试使用假 `runuser`、curl、npm 和测试生成的 CLI，模拟 `.local/bin`、`.kimi-code/bin`、`.grok/bin` 与版本参数。它验证本地命令构造和错误处理，不会证明上游脚本与测试桩始终一致。Oh-My-Pi 与 Kimi 的调用方式另有上游脚本/元数据核对；Grok 没有完成这一层核对。

第一轮测试曾把假 CLI 预先放入测试 PATH，从而漏掉厂商目录和 Bun 入口问题。补充测试改为让假安装器在预期原生目录产生可执行文件，并验证独立二进制参数。真实工具冒烟测试仍须遵守 [AGENTS.md](../../AGENTS.md) 中的显式授权和 `agentintegration` 约束。

## 5. 发布记录与升级边界

本节是截至 2026-09-24 本次工作会话结束时的记录，不是实时部署状态。

| 阶段 | 记录 |
| --- | --- |
| 第一轮修复部署 | 部署目录为仓库旁的 `../multica-deploy`；发布标识 `runtime-fixes-20260924T092411Z`，包含当时未提交的源码快照。 |
| 部署检查 | 前后端镜像构建通过，生产前端 TypeScript 检查通过；新容器 healthy、重启数为 0。25 项 HTTP 检查通过，覆盖健康接口、登录页、静态资源和未登录访问管理员 API 返回 401。 |
| 数据保护 | 对比旧镜像中的 1130 个迁移文件，内容一致；备份数据库和配置，保留旧镜像；数据库与网关容器未重建。 |
| 构建环境差异 | 后端第一次构建无法连接 `proxy.golang.org`，发布用 Dockerfile 在下载阶段改用可访问的 Go 模块镜像，保留依赖校验。 |
| 第二轮补充修复 | 合并为 `e8d97ddc8`，已推送到 `origin/feat/admin-area-computer-management`；本次会话未再次部署。 |

因此，第一轮部署成功的结果**不能作为最终提交 `e8d97ddc8` 已上线的证据**，也不能作为真实 CLI 安装成功的证据。

发布快照、构建日志和回滚说明位于部署目录的 `releases/runtime-fixes-20260924T092411Z/`；当时备份位于 `backups/pre-runtime-fixes-20260924T092411Z/`。这些是该部署环境的本地资料，不是仓库内通用路径。回滚前应核对实际当前版本和后续迁移，不应长期照搬历史镜像或备份。

应用镜像更新不会自动刷新已有远端 systemd unit，也不安装远端的 Node/npm。要让本次 PATH 修改生效，需要对已有绑定执行“升级运行时”；该操作会重启对应 daemon，执行前应考虑用户正在运行的任务。

## 6. 仍需跟进

1. **独立核验 Grok 上游。**读取可访问的官方脚本或文档，确认位置版本参数、`latest` 语义和实际安装目录；当前只有按 review 约定构造命令的测试。
2. **补齐真实环境验证。**在明确指定的非生产 Computer/账号上验证三种厂商安装器、daemon PATH、版本探测和注册；模型账号认证与实际运行另测。
3. **补跑数据库 handler 用例。**使用仓库管理的测试环境，不连接生产数据库；确认测试真正运行，而非被 `TestMain` 跳过。
4. **增强审计语义。**当前仅记录请求版本和结果，未记录目标 Linux 用户、实际版本；写库失败也没有持久重试。
5. **确认初始化契约。**oh-my-zsh 等联网安装仍在开通关键路径。若产品希望账号创建与工具增强解耦，需要明确独立状态、重试和界面表现。
6. **供应链和异常恢复。**脚本先完整下载不等于脚本内容可信；第三方安装器内部下载行为、断电/SIGKILL 后恢复和 dpkg 中断状态仍需独立处理。

## 7. 代码与测试索引

- 安装方式及回归：[builtin_runtimes.go](../../server/pkg/agent/builtin_runtimes.go)、[builtin_runtimes_test.go](../../server/pkg/agent/builtin_runtimes_test.go)。
- API、探测、审计、公钥：[instance_admin.go](../../server/internal/handler/instance_admin.go)、[instance_admin_test.go](../../server/internal/handler/instance_admin_test.go)。
- SSH、超时和回滚：[ssh_remote.go](../../server/internal/computer/ssh_remote.go)、[ssh_remote_test.go](../../server/internal/computer/ssh_remote_test.go)、[scripts_test.go](../../server/internal/computer/scripts_test.go)。
- unit 与主机检查：[files.go](../../server/internal/computer/files.go)、[probe.go](../../server/internal/computer/probe.go)、[probe_test.go](../../server/internal/computer/probe_test.go)。
- 解析与 Query：[client.ts](../../packages/core/api/client.ts)、[client.test.ts](../../packages/core/api/client.test.ts)、[admin-schema.ts](../../packages/core/computers/admin-schema.ts)、[admin.ts](../../packages/core/computers/admin.ts)。
- 界面与交互回归：[admin-page.tsx](../../packages/views/admin/admin-page.tsx)、[admin-page.test.tsx](../../packages/views/admin/admin-page.test.tsx)。
