# 运行时模型配置部署记录

2026-10-09 已将提交 `b7c9645c6` 部署到现有自托管环境，访问地址为 `http://10.10.0.31:3000`。本文记录此次发布的实际结果，不代表后续环境的实时状态。功能和权限契约见[运行时模型配置方案](../design/runtime-model-configuration.md)，上游字段约定见[sub2api 接口契约](../design/sub2api-key-directory-contract.md)。

## 发布范围与版本

本次发布包含 Admin Area 的统一 sub2api 查询凭证、用户 API key 分配、运行时模板，以及“我的 Linux 用户”中的配置读取、编辑、保存、检查和 CLI 连接测试。兼容范围由 `platform` / `protocols` 与运行时支持协议计算。同步包含异步操作错误传播、目录刷新冷却、配置文件崩溃恢复和授权失效状态等 review 修复。

| 项目 | 发布记录 |
| --- | --- |
| 记录时间 | 2026-10-09 12:04:46（Asia/Shanghai）；部署记录时间为 `2026-10-09T04:04:46.896982+00:00` |
| 操作者 | Codex，按用户更新部署的指令执行 |
| 功能提交 | [`b7c9645c6`](https://github.com/trustbe-cn/multica/commit/b7c9645c6)，`feat(computers): configure runtime model keys` |
| 分支 | `feat/admin-area-computer-management`，已推送到 origin |
| 部署目录 | `/home/tiger/bench/multica-deploy`，独立于应用 Git 仓库 |
| 后端镜像 | `multica-backend:ac5304629` → `multica-backend:b7c9645c6` |
| 前端镜像 | `multica-web:ac5304629` → `multica-web:b7c9645c6` |
| 源码快照 | 部署目录下 `releases/model-configuration-b7c9645c6/source/`，由该提交的 `git archive` 生成 |
| 构建差异 | 后端沿用上一轮部署专用 Dockerfile 的 `GOPROXY=https://goproxy.cn,direct`；应用仓库 Dockerfile 未因此修改 |
| 远端守护进程 | 本次只更新应用容器，没有执行远端守护进程升级或 CLI 安装 |

## 数据库与发布步骤

部署前执行 `pg_dump -Fc`，备份保存在部署目录下 `backups/pre-model-configuration-b7c9645c6.dump`，使用私有文件权限；`pg_restore --list` 读取成功。本次没有执行恢复演练。凭证、备份内容和部署环境变量均不进入应用仓库。

| 迁移 | 内容与结果 |
| --- | --- |
| `546_model_key_configuration` | 新增查询来源、key 目录、用户授权、运行时模板和配置元数据表；成功 |
| `547`–`553` | 新增目录名称、用户分配顺序和各表唯一性索引；每个索引单独执行 `CONCURRENTLY` 迁移，全部成功 |
| `554_runtime_model_configuration_metadata` | 补充授权名称、配置文件清单和测试结果字段；成功 |
| `555_model_key_source_retry_after` | 补充目录刷新重试时间；成功 |
| `556_runtime_model_save_operation` | 补充最近一次配置保存操作标识；成功 |

`schema_migrations` 记录数从 **573 增至 584**，最新记录从 `545_computer_daemon_observation` 变为 `556_runtime_model_save_operation`。记录数不是迁移版本号。部署后查询无无效索引。

镜像构建和容器内文件检查通过后，只修改 `compose.yml` 中的两个应用镜像标签，再执行：

```sh
cd /home/tiger/bench/multica-deploy
./manage config --quiet
./manage up -d --no-deps --wait --wait-timeout 180 backend frontend
```

backend 启动入口先运行迁移，成功后启动 API。PostgreSQL、下载代理和网关的容器 ID 与启动时间在更新前后完全一致。

## 验证结果与边界

| 验证 | 实际结果 |
| --- | --- |
| `pnpm typecheck` | 10/10 workspace 通过 |
| `pnpm lint` | 通过，0 errors；存在仓库已有 warning |
| `make env-exec ARGS='-- bash scripts/test-go.sh --race'` | 完整 Go race 测试通过，包含 computer、handler、sub2api 和 agent 包 |
| core/views 定向测试 | 实现阶段相关模型配置 schema、API 客户端、key 面板、模板面板和配置对话框测试通过；部署阶段未重复运行 |
| 生产构建 | backend/frontend Docker 镜像均构建成功；后端 CLI 版本与迁移文件检查、前端启动文件语法检查通过 |
| 应用容器 | backend/frontend 均为 healthy；当次记录未单独采集重启次数 |
| 健康接口 | `127.0.0.1:18000`、`127.0.0.1:13000`、`10.10.0.31:3000` 的 `/health` 均返回 200、`status=ok`、`commit=b7c9645c6` |
| 未登录管理接口 | 上述三个地址的 `/api/admin/computers`、`/api/admin/model-key-source`、`/api/admin/model-key-directory`、`/api/admin/model-key-users` 均返回 401 |
| 登录页 | `http://127.0.0.1:13000/login` 返回 200 |
| 日志检查 | 上线后的检查窗口内，backend/frontend 日志未匹配到 `ERR`、`FATAL`、`panic:` 或 `ERROR` 级别标记 |

HTTP 检查合计 **16 项**。前端和网关的 `/health` 是代理后端响应，不能单独证明前端源码版本；前端身份另由构建记录和实际容器镜像标签确认。

本次发布未执行浏览器 E2E、真实 CLI 模型调用、生产用户配置保存或上游凭证联调。健康检查与未登录鉴权检查通过不等于所有运行时的模型连接均已验收；真实上游和目标 CLI 的验证边界仍以设计文档为准。

## 证据位置与回滚

以下资料均位于部署目录下 `releases/model-configuration-b7c9645c6/`，不是应用仓库文件：

- `DEPLOYMENT.md`：现场部署与回滚记录。
- `build-backend.log`、`build-web.log`：镜像构建日志。
- `compose.before.yml`、`compose.deployed.yml`：变更前后 Compose 快照。
- `verification.json`：16 项 HTTP 检查结果。
- `unchanged-services.json`：数据库、代理和网关的容器身份与启动时间。

回滚前先停止提交新远端操作并等待活动操作完成，避免新版操作与旧版逻辑混跑。将当前 `compose.yml` 的 backend/frontend 镜像分别改回 `multica-backend:ac5304629` 和 `multica-web:ac5304629`，然后执行上述应用更新命令并重新检查健康、镜像标签与鉴权。旧镜像已保留。

本次数据库变更为新增表、索引和字段。应用回滚时保留这些结构与已写入的配置元数据；不要自动执行 down 迁移或恢复发布前备份，以免丢失发布后的新数据。若后续又有发布，先重新核对实际镜像与迁移再决定回滚目标。
