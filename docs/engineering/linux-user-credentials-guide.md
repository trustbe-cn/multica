# Linux 用户建号与个人凭据

本次实现将账号创建、个人凭据、远端配置与守护进程启动拆开。部署版本以 `/home/tiger/bench/multica-deploy/releases/` 下的发布记录及服务健康检查为准。

## 页面与操作

| 入口或动作 | 作用 |
| --- | --- |
| 设置 → 我的运行环境 | 创建或验证本人 Linux 账号，查看账号、CLI、守护进程及操作记录。不会加载个人凭据。 |
| 设置 → 个人凭据 | 编辑可选的个人配置模板，查看字段获取说明，选择本人账号读取或写入。 |
| 工作区设置 → Linux 用户 | 将本人账号关联当前工作区。已有账号是 Multica 已验证所有权的账号；远端已有但从未验证的账号也可在“新建账号”填写原用户名和密码进行验证，不会重置其密码。 |
| 从服务器读取 | 对所选账号进行 Linux 密码验证，将支持的配置读回表单。替换当前草稿，但不会保存个人模板，也不会修改服务器。 |
| 保存凭据 | 加密保存个人模板到 Multica，不修改远端 Linux 用户。远端读取后的草稿须单独勾选确认，才可将其中密钥保存为可用于其他账号的个人模板。允许分步填写，不要求先提供 PAT 或 Git 身份。 |
| 写入 Linux 用户 | 验证密码，将表单中非空字段应用到所选账号的受管配置。空字段保留服务器值；模型环境字段作为一组替换。不会启动或重启守护进程。 |
| 启动或升级守护进程 | 在账号锁内先验证 Linux 密码，再读取服务器上该绑定的现有配置、检查 Multica PAT 归属，安装或更新受管 CLI 并启动服务。不会用个人模板覆盖手动配置。 |

账号创建成功后显示“待配置”，表示 Linux 账号已存在且所有权已验证，不表示守护进程在线。可先安装 CLI、手动配置，或在个人凭据页面写入，再启动守护进程。账号接入和远端操作是异步的，“请求已接受”不代表远端成功；以最近操作的终态为准。

远端草稿标明来源账号。切换 Linux 用户会清除当前草稿、密码及导入确认，恢复已保存的个人模板；读取结果不会自动成为其他账号的写入内容。

## 建号与安装交互

- 建号保留系统包安装、zsh、账号与密码设置，不再联网安装 Oh My Zsh。可选 shell 增强的下载失败不会删除已经创建的账号；密码设置失败仍执行账号回滚。
- Linux 密码框提供显示/隐藏按钮，默认隐藏；切换目标账号或操作会重新隐藏。显示按钮不会提交表单，也不会修改密码内容。
- CLI runtime 版本可以留空，后端将缺省值或空字符串统一记录为 `latest`；填写时仍安装指定版本并校验字符白名单。界面提示“留空安装最新版”。
- runtime 列表新增 `supports_version` 表示是否支持固定版本；`version_required` 返回 false。新客户端兼容旧响应的版本能力字段；旧客户端仍可按 latest 安装。

## 字段如何获取

| 字段 | 来源与用途 |
| --- | --- |
| Git 作者名 | 代码提交署名。以目标 Linux 用户运行 `git config --global user.name` 查看现有值。 |
| Git 作者邮箱 | 填写在代码托管平台验证过的邮箱；`git config --global user.email` 可查看现有值。 |
| GitLab URL | 实际 GitLab 站点的 HTTP(S) 地址，例如 `https://gitlab.example.com`。使用 GitLab Token 时需要。 |
| GitLab Token | 在 GitLab 用户设置的 Access tokens 创建；Git HTTPS 拉取与推送分别需要相应的仓库读写权限。不要求额外授予管理权限。使用 SSH 时可不填。 |
| Git SSH 私钥 | 使用专门给该账号访问仓库的 SSH 密钥；将对应 `.pub` 公钥登记到 GitLab。填写的是私钥，和 Computer 运维账号登录用的公钥不是同一用途。暂不支持带口令的私钥。 |
| SSH known hosts | Git 服务器的可信主机密钥记录，来自已核验的 `~/.ssh/known_hosts`。`ssh-keyscan` 只能获取候选公钥，须独立核对指纹后信任。它不控制 Multica 后端连接 Computer 的主机校验。 |
| 模型 API Key | 在模型服务商控制台创建，逐行填写 `KEY=value`。支持 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`OPENROUTER_API_KEY`、`GEMINI_API_KEY`、`XAI_API_KEY`。各 CLI 的 OAuth 登录会话不等于这些 API Key。 |
| Multica PAT | 本人 Multica 设置的 API Token 页面创建。启动受管守护进程需要有效且属于本人的 PAT；创建 Linux 用户不需要。 |

所有字段均可留空。字段之间仍有依赖：填写 GitLab Token 时需提供 URL；填写 Git SSH 私钥时需提供 Git 服务器的 known hosts。

## 服务器配置范围

读取和写入均以目标 Linux 用户权限执行，不以 root 读取其配置。固定路径位于该账号实际 home 下：

| 配置 | 路径 |
| --- | --- |
| Git 身份 | `~/.config/multica-provision/gitconfig`；缺少字段时读取 `~/.gitconfig` 的直接定义，不递归读取额外 include 文件。 |
| GitLab Token | `~/.config/multica-provision/gitlab.token`；GitLab URL 优先读取受管 Git 配置中的 `multica.gitlabUrl`，缺失时从受管 Git helper 解析。 |
| Git SSH 私钥 / 主机记录 | `~/.config/multica-provision/git.key`、`~/.config/multica-provision/known_hosts` |
| 模型环境 | `~/.config/multica-provision/model.env`，受支持的 `KEY=value`，允许受管写入器产生的引号。 |
| Multica 认证 | `~/.multica/profiles/computer-<binding-id>/config.json` 的 `token` 字段 |

`binding-id` 可从 Linux 用户详情的守护进程 ID 获取。写入操作同时维护此 profile 的服务地址、工作区 ID 和健康端口，并保留其他 JSON 配置。受管 Git 配置通过 include 接入 `.gitconfig`，不会替换整个文件。

不读取或执行 `.zshrc`、`.bashrc`，不扫描整个 home，也不导入其他 CLI 的私有会话或默认 Multica profile。将手动配置放在上述位置后，可从页面读回。如果手动填写 profile 并直接启动 daemon，还需保证该 profile 的 `server_url`、`workspace_id` 等运行参数正确；使用页面“写入”会设置它们。

读取只允许已验证的账号所有者，实例管理员或工作区成员不会因此获得读取他人密钥的入口。读写前仍校验 Linux 密码，复用密码失败计数和账号操作互斥；审计仅记录动作与结果。响应禁止缓存，客户端对畸形凭据响应使用脱敏解析，密码和远端密钥不进入操作表或日志。

## API 与兼容性

- `POST /api/me/computer-bindings` 新增 `action=create_account`：建号或密码验证、建立绑定，成功后为 `pending`，不读取个人凭据、不写配置、不安装守护进程。
- `POST /api/me/computer-bindings/{id}/credentials/read`：请求含 `password`，返回 `operator` 和 `settings`，仅回填表单。
- `POST /api/me/computer-bindings/{id}/credentials/write`：请求含 `password`、`settings`，写入非空配置，返回 `saved=true`。
- `PUT /api/me/computer-settings` 允许保存部分字段；非空 PAT 仍验证归属。
- `upgrade` 使用远端配置启动服务。已有客户端使用的 `provision`、`sync` API 保持原有调用入口；新 UI 不再用“同步”表示写入。

本次不新增数据库实体或迁移，沿用 `computer_binding`、`computer_credential` 和 `computer_operation`。同一账号仍不能同时服务两个工作区。

## Review 核查与错误反馈

- 跨账号草稿残留成立，已加入来源绑定、切换清理及远端导入模板确认。
- upgrade 提前读取配置成立，读取与 PAT 校验已移至密码验证成功之后，仍在同一账号锁内执行；错误密码及锁定测试均断言不读取凭据、不准备或安装 daemon。
- “读写接口成功响应缺少禁止缓存头”不成立：原实现的 `bindingAccess` 已设置 `Cache-Control: no-store`。现在还在接口入口显式设置，覆盖权限检查前的失败，并用 HTTP 测试验证。
- 凭据传输错误返回稳定 `code` 和脱敏说明，页面使用本地化文案。密码错误为 403 / `password_mismatch`，锁定为 429 / `password_locked`，账号策略拒绝为 422 / `account_unavailable`，SSH 失败为 502 / `ssh_unreachable`，超时为 504 / `ssh_timeout`，配置不可读取或无效为 422 / `credential_transfer_failed`。操作历史保留相同错误分类，不包含远端命令输出。

## 验收步骤

1. 不保存个人凭据，在测试 Computer 上创建账号。提交按钮可用，操作成功后账号显示“待配置”；没有 daemon 在线也不应被判定为建号失败。
2. 打开个人凭据，分步保存 Git 姓名等字段，确认无需 PAT。保存后远端未自动变化。
3. 选择本人账号，输入密码，点击写入。回到空白或修改后的草稿执行读取，确认 Git 身份、模型配置等可往返；读取后未点击保存前，个人模板不应改变。
4. 在受管文件里手动改值，再读取验证；只填写一个字段写入，确认其他空字段对应的服务器值保留。
5. 写入本人的 PAT，按需安装 CLI，再从我的运行环境启动守护进程。账号就绪必须由匹配账号和工作区的实时注册确认。
6. 读取账号 A、修改草稿后切换到 B，确认草稿恢复为个人模板且密码清空；B 不应收到 A 的远端密钥。重新读取 A 后，“保存凭据”在勾选导入确认之前不可用。
7. 使用另一名成员验证不能读取或写入该账号；密码错误应失败并产生不含密码或凭据内容的操作记录。

自动化测试覆盖临时 home 中的真实配置脚本、假 SSH 下的 handler 和数据库回归，不等同于真实远端账号或浏览器端到端验收。

凭据分离首轮验证：共享界面 26 项测试、core 10 项测试通过；隔离测试库中的 29 个顶层 handler 测试通过 `-race`；Computer 包通过 `-race`；views 类型检查、修改范围内 ESLint、Go vet、server 构建、sqlc 生成及文档链接检查通过。未在真实 Computer 上执行本轮建号或凭据读写，未执行已登录浏览器 E2E。发布提交与部署校验单独记录在部署目录，不将自动化测试等同于真实主机验收。

建号与安装交互补充验证：共享界面 28 项测试、core Computer 模块 9 项测试通过；Computer 包竞态测试，以及隔离数据库上的无凭据建号、runtime 版本与审计接口测试通过。实际主机只进行了只读诊断，未代用户输入密码重建账号，也未执行真实 runtime 安装。
