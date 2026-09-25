# Computer P0/P1 实施与验收记录

日期：2026-09-25。状态：代码在工作树中，未提交、未部署。线上仍为 `07f1e09c4`，见[部署核对](computer-runtime-review-fixes.md#2026-09-25-部署核对)。

## 已实现

- 持久化远端操作元数据、状态、阶段、版本和安全错误摘要；请求断开后继续执行，过期操作需明确确认恢复，不持久化或重放密码。
- 在 PostgreSQL 中统一同一 Computer/Linux 用户的互斥；安装增加远端 flock 和进程组超时。
- Linux 用户详情、最近操作和恢复入口，分开显示账号、daemon 服务、CLI 安装与运行时注册。
- 运行时资产快照、实际版本/路径/来源/安装与检查时间；失败不清空最后已知资产。
- 显式重新发现，安装后通知 daemon 刷新，新 daemon 即时唤醒 CLI 发现循环。
- 删除 daemon、归档 binding、删除 Linux 用户分开确认；归档保留历史和所有权并解除 Computer 删除阻塞；原工作区已删除的所有者仍可移除 daemon。
- 安装 API 用 `Prefer: respond-async` 支持新界面的持久进度，旧客户端保持同步成功响应。

完整契约见[远端操作与清理设计](../design/computer-remote-operations.md)。

## 测试环境与证据

仓库默认 PostgreSQL 端口 5432 已被其他服务占用。使用仓库 Compose 和 `make migrate-up` 创建独立项目 `multica-p0-tests`，将 PostgreSQL 仅绑定到 `127.0.0.1:15543`，数据库为 `multica_multica_757`。测试没有使用部署数据库、生产 SSH 密钥或真实用户凭据，也未修改主 checkout 的 `.env`。

临时端口覆盖文件为 `/tmp/multica-p0-postgres.yml`，内容如下（需要支持 `!override` 的 Compose）：

```yaml
services:
  postgres:
    ports: !override
      - "127.0.0.1:15543:5432"
```

迁移通过以下仓库命令应用：

```sh
COMPOSE_PROJECT_NAME=multica-p0-tests \
COMPOSE_FILE=/home/tiger/bench/multica/docker-compose.yml:/tmp/multica-p0-postgres.yml \
make migrate-up \
  DATABASE_URL='postgres://multica:multica@localhost:15543/multica_multica_757?sslmode=disable'
```

上述连接字符串仅用于本次隔离的本地测试容器，不是部署配置。临时环境不是生产服务，停止时使用对应 Compose 项目，不要操作生产项目。

已验证的行为包括：同一账号的操作互斥、HTTP 取消不取消后台操作、过期状态投影与显式恢复、取消的任务不执行、所有者隔离、失败探测保留旧资产、系统服务状态与运行时注册独立、归档保留所有权并允许 Computer 删除。默认 SSH/安装测试使用测试创建的命令桩；版本探测测试仅运行临时目录中的假 CLI。

最终验证结果：

| 检查 | 结果 |
| --- | --- |
| `make migrate-up`，隔离数据库 | `540`–`545` 应用成功；生产数据库保持 `539`。 |
| `GOPROXY=https://goproxy.cn,direct make sqlc` | 成功，生成模型已更新。默认 Go 代理连接超时后使用可达代理，未关闭校验。 |
| Computer/handler 定向回归，`-race` | 20 个顶层用例通过；handler 确实连接测试数据库，没有跳过。 |
| `go test ./internal/computer` | 包内完整测试通过。 |
| `go test -p 2 -parallel 2 ./pkg/agent -count=1` | 通过。默认高并发运行曾有两项 Dim 临时可执行文件报 `text file busy`；按仓库测试脚本的并发设置重跑通过。 |
| daemon 刷新通知回归 | 通过；通知会唤醒 CLI 发现循环，不调用真实 CLI。 |
| 并发索引与迁移 runner 契约检查 | 通过。 |
| core API/schema | 130 项通过。 |
| Admin/设置共享视图 | 20 项通过，包含持久操作展示及账号删除确认。 |
| core / views TypeScript | 均通过。先用 `pnpm --filter @multica/views... install --frozen-lockfile --offline --ignore-scripts` 恢复本地缓存依赖；锁文件无变更。 |
| 修改涉及的 core / views ESLint | 通过。 |
| server 编译、`agentintegration` 测试文件编译 | 通过；通过 `-run '^$'` 仅编译，没有运行真实冒烟。 |
| 文档本地链接、`git diff --check` | 通过。 |

没有执行全仓 E2E、真实模型任务或生产部署。

## 真实非生产验收：尚未执行

缺少明确指定的测试 Computer，或用户对本机隔离测试主机选项的答复。这一项保持未完成；隔离 PostgreSQL 和命令桩测试不能代替真实主机验收。

已经增加显式门控的安装冒烟测试，执行前必须获得授权。环境变量要求：

- `MULTICA_RUN_REAL_AGENT_SMOKE=1`
- `MULTICA_COMPUTER_SMOKE_ENVIRONMENT=nonproduction`
- `MULTICA_COMPUTER_SMOKE_HOST`、`MULTICA_COMPUTER_SMOKE_PORT`
- `MULTICA_COMPUTER_SMOKE_OPERATOR`、`MULTICA_COMPUTER_SMOKE_SSH_KEY`
- `MULTICA_COMPUTER_SMOKE_LINUX_USER`，必须是提前开通的 `multica_smoke_*` 临时账号

```sh
cd server
MULTICA_RUN_REAL_AGENT_SMOKE=1 go test -tags=agentintegration ./pkg/agent \
  -run '^TestComputerRuntimeInstallSmoke$' -count=1 -v
```

该测试实际安装七种 CLI 的 latest 版本，验证目标用户下的可执行路径与版本，不登录模型账号，也不运行模型任务。它不是完整生命周期验收；仍需在隔离服务和临时账号上逐项完成：

| 项目 | 预期证据 | 当前状态 |
| --- | --- | --- |
| provision / reuse | PAM、安全策略、账号与 home、配置、daemon 身份和工作区注册 | 待验收 |
| sync / upgrade | 凭据/版本变化、unit PATH、生效后的 daemon 注册 | 待验收 |
| 七种 CLI 安装 / 发现 | 系统和工具链来源、安装目录、实际版本、daemon 发现结果 | 待验收 |
| 错误场景 | 缺失 CLI、版本失败、安装器失败、SSH 超时、daemon 离线与恢复 | 待验收 |
| remove / archive | 服务被移除，账号与 home 保留，历史可追溯 | 待验收 |
| delete_user | 明确确认、运行进程阻止删除、重试与账号/home 删除 | 待验收 |

只读下载 `https://x.ai/cli/install.sh` 在连接阶段超时；Grok 上游版本参数及脚本可用性仍需独立核验。未经真实验证不能将上述项目标为通过。
