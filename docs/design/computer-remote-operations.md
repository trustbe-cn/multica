# Linux 用户远端操作、资产与清理

本文描述 P0/P1 实现的操作契约，补充[身份模型](computer-runtime-identity-model.md)和[管理入口](linux-user-runtime-management.md)。实现已随 `b528fd809` 部署，部署状态以[发布记录](../engineering/computer-runtime-review-fixes.md#2026-09-25-p0p1-部署)为准。

## 操作记录与执行

`computer_operation` 保存 binding、Computer、Linux 用户、发起者、操作种类、请求版本、实际版本、状态、当前步骤和时间戳。错误只保存固定错误码与安全摘要；不保存密码、个人凭据、原始 SSH 输出或可重放的任务参数。

| 状态 | 含义与后续动作 |
| --- | --- |
| `queued` | 记录已提交，执行尚未开始。可取消；取消和启动通过条件更新互斥。 |
| `running` | 后台执行中，HTTP 断开不取消任务。最多执行 15 分钟。 |
| `succeeded` | 对应远端步骤已完成；CLI 安装还必须通过目标用户下的版本检查。 |
| `failed` | 收到明确失败。按错误码修复问题，再明确提交重试。 |
| `cancelled` | 尚未开始的操作被取消，没有执行远端步骤。 |
| `interrupted` | 未得到可靠的最终结果。活动记录超过 20 分钟时按此状态展示，保留互斥占用，直到所有者确认已检查远端状态。 |

后端重启不会自动重放任务。所有者确认过期操作后，将记录终结为 `interrupted` 并释放占用；开通/同步等操作要重新输入 Linux 密码。记录步骤及结果不代表有持久任务队列，也不保证任意 SSH 断线时远端副作用都已回滚。恢复动作不执行远端安装或删除。

同一 `(computer_id, username)` 的活动操作由 PostgreSQL 部分唯一索引互斥。开通的 binding claim 与操作入库在同一事务内；安装、发现与生命周期动作也锁定 binding 后入库。安装额外使用远端 root 持有的 `flock` 和进程组超时，阻止孤立安装进程与重试交叠。PAM 尝试计数仍使用原有 FileStore。

操作结束与审计写入同一事务。收尾最多尝试三次，每次使用独立的三秒超时，只重试数据库元数据，不重放远端操作；提交结果不确定时也不会重复审计。失败记录安全错误分类与操作 ID，panic 记录堆栈而不记录其任意内容。如果仍无法写入最终结果，记录保持可恢复的活动状态，之后显示已中断。同步安装等待也将过期活动记录视为 interrupted 并返回 502，但不会释放互斥占用。不能因为远端命令返回 0 就向用户承诺审计已落库。

恢复、绑定结果与资产写入按 binding → operation 的顺序加锁。worker 写入必须匹配原 operation，且仍处于未过期的 running 状态；明确恢复提交后，旧 worker 不能覆盖后续操作的绑定或资产。恢复接口仅在没有符合条件的记录时返回 409，数据库异常返回 500。

## 错误与重试

账号缺失/不可用、密码不匹配/尝试锁定、SSH 不可达/超时、sudo 失败、包管理器失败、Node/npm/Bun 缺失、安装器失败、CLI 缺失、版本检查失败、daemon 未注册和账号删除失败具有独立错误码。前端对已知错误码提供本地化恢复提示，未知错误保留服务端安全摘要。

重试是一次新操作，会重复所选择的步骤。同步重写个人配置并重启 daemon，升级还会替换 daemon 可执行文件；安装会重新执行安装器。重新发现只检查 CLI 并发送 daemon 刷新提示，不重启正在运行的任务。未安装 CLI 是正常资产状态，不使整个发现操作失败。

## Linux 用户详情与四层状态

详情在设置的绑定行以及 Admin Area 的 Linux Users 中展开；Web/Desktop 共用实现，不增加全局路由。

| 层次 | 依据 |
| --- | --- |
| Linux 账号 | 最近一次账号检查的 `present/missing/unknown` 及检查时间。检查失败保留既有观察结果，返回明确错误。 |
| daemon 服务 | 远端 `systemctl is-active` 的 `running/stopped/failed/unknown` 观察及检查时间。它是一次观察，不代表持续在线。 |
| CLI 安装 | 目标 Linux 用户显式 PATH 下的可执行文件路径、版本命令结果及探测时间。 |
| 运行时注册 | 匹配 binding 的 daemon ID、owner 和 workspace 的 `agent_runtime`；在线要求状态为 online 且最近 30 秒有心跳。 |

daemon 服务运行与 CLI 注册分别展示。账号存在、daemon 服务运行，但尚无 CLI 注册，是合法的中间状态；不能把“没有注册”解释为“没有安装”。绑定 `ready` 仍表示上次 provisioning 成功，不能代替上述状态。

`computer_runtime_asset` 保存路径、安装目录、请求/实际版本、安装器来源、成功安装时间、最近检查时间和探测 PATH。安装失败仍尝试检查实际产物。一次探测失败不覆盖最后已知路径、版本或成功安装时间；界面同时显示当前探测错误。明确找不到 CLI 时状态为 `missing`，旧版本只作为历史值保留。

成功安装和手动重新发现会向该 Multica 用户的 daemon 发送现有 workspace refresh 提示。新版 daemon 收到提示后立即唤醒 CLI 发现循环。服务端发出提示不等于注册已完成；离线 daemon 的资产继续显示未发现。旧 daemon 可依赖原有周期发现，升级后才支持此即时唤醒行为。

## API

以下路径均以 `/api/me/computer-bindings/{id}` 为前缀，要求当前用户拥有 binding；用户名只从数据库读取。

| 方法与后缀 | 行为 |
| --- | --- |
| `GET` | binding、Computer、工作区、账号/daemon 观察结果和最近注册时间。 |
| `GET /operations` | 最近 50 条操作，含过期状态投影。 |
| `POST /recover` | `operation_id` 与 `action=cancel/acknowledge`；不重放任务。 |
| `GET /runtimes` | 读取资产快照，不在 GET 中发起 SSH。尚未检查显示未知。 |
| `POST /discover` | 异步探测七种 CLI，并通知 daemon 刷新。 |
| `POST /runtime-install` | 新客户端发送 `Prefer: respond-async`，返回 202 与操作 ID；旧客户端等待同一后台任务结束，仍收到 `installed: true` 或错误。 |
| `POST /check` | 检查账号和 daemon 服务，保存观察时间。 |
| `POST /lifecycle` | `remove`、`delete_user`、`archive`，要求输入目标用户名确认。前两者要求 Linux 密码，仅保留在内存中。 |

管理员可读取 `/api/admin/computer-bindings/{id}`、`/operations`，并调用 `/check`。管理员详情不提供代替用户安装 CLI、删除 Linux 用户或重试其私有操作的入口。

## 移除、归档和删除

| 动作 | 权限、前置条件 | 删除与保留 |
| --- | --- | --- |
| 移除 daemon | 已验证 binding 的所有者，PAM 验证；即使原工作区已删除也能执行。 | 停止并删除受管服务和 daemon 可执行文件，保留 Linux 账号、home、CLI、配置、凭据和历史注册。 |
| 归档 binding | 所有者，binding 已 removed，无活动操作，输入用户名确认。 | 隐藏个人列表条目，不再阻止 Computer 删除；保留账号所有权、资产与操作历史。 |
| 删除 Linux 用户 | 所有者，先移除 daemon，PAM 验证并输入用户名确认。 | `userdel -r` 删除账号和 home。拒绝 root/operator；不用 force、不杀用户进程，存在运行中进程时失败。失败保留 binding 和操作记录，可修复后重试。 |
| 删除历史操作 | 当前无产品 API。 | 操作和审计保留供追溯；不能通过删除历史释放正在执行的占用。后续保留期限须单独设计。 |

删除账号后，绑定保留 `state=removed`，账号观察更新为 `account_state=missing`。二者分别表示受管服务已移除与 OS 账号不存在；重新开通实际检查远端账号，缺失时创建，存在时验证密码。

归档后的历史仍属于原用户。Computer 删除不会删除这些记录，也不会删除远端 OS 账号；失去 Computer 登记后，对其遗留账号的处理属于显式运维工作。删除工作区 runtime 的依赖检查仍走原有工作区 API。

## 迁移与升级

新增 `540`–`545` 迁移：操作表、资产表、binding 归档与观察字段，以及四个各自独立的并发索引。没有外键或级联删除。迁移 runner 注册了索引失败后的 invalid-index 清理。

部署前备份数据库，先完成迁移，再启用新版应用。旧应用不理解操作互斥和资产记录，存在活动操作时不能滚动混跑；回滚前应暂停新操作并等待现有任务结束。回滚应用可保留新增表和字段；执行 down 会删除操作/资产数据，只能在明确接受数据丢失并持有备份时进行。
