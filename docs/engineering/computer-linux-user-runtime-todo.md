# Computer、Linux User 与运行时 TODO

本文记录 Computer、Linux User、守护进程和 CLI 运行时管理在当前实现之后的下一阶段工作。优先级按用户影响、数据恢复风险和实施依赖排序。完成一项后应补充测试证据和部署记录。

## P0：先建立可靠的验收基线

### 1. 修正发布与部署记录

- [x] 更新 [Computer 与运行时 review 修复记录](computer-runtime-review-fixes.md)，说明 `07f1e09c4` 已部署到 `/home/tiger/bench/multica-deploy`。
- [x] 把历史发布记录与当前部署状态分开，避免把旧 release 的验证结果当作当前版本证据。
- [x] 每次部署记录 backend/frontend commit、镜像标签、健康检查结果、数据库迁移结果和回滚标签。

验收：新 Agent 只读 `docs/` 和主仓库 `AGENTS.md`，可以判断当前功能提交、部署目录和验证范围，不会得到相互矛盾的版本信息。

### 2. 在非生产 Computer 上完成真实链路验收

- [ ] 新建或复用 Linux User binding。
- [ ] 验证 `provision`、`sync`、`upgrade`、`remove` 的账号、配置和 daemon 状态变化。
- [ ] 验证 Claude、Codex、OpenCode、Pi、Oh-My-Pi、Kimi、Grok 的安装、版本探测、daemon PATH 和重新发现。
- [ ] 分别验证安装成功、CLI 不存在、版本命令失败、安装器失败、SSH 超时和 daemon 离线。
- [ ] 将主机发行版、Node/npm/Bun 来源、实际安装目录和测试结果写入发布记录。

验收：至少有一台明确的非生产主机完成完整链路；真实测试不使用生产数据库、生产 SSH 密钥或真实用户凭据。

## P0：统一远端操作状态

### 3. 引入远端操作记录

统一记录 provisioning、daemon upgrade、runtime install 和 runtime discovery：

- [x] 增加操作类型、目标 binding、发起用户、状态、开始/结束时间、错误码和错误摘要。
- [x] 状态至少支持 `queued`、`running`、`succeeded`、`failed`、`cancelled`、`interrupted`。
- [x] 记录当前步骤，例如 `checking_account`、`installing_packages`、`installing_runtime`、`refreshing_daemon`。
- [x] 记录请求版本和实际探测版本；不要把请求版本当作实际安装版本。
- [x] 为过期的 `running` 操作提供恢复或人工确认路径。

验收：用户断开页面、请求取消、SSH 超时、后端重启后，页面仍能显示最后一个可靠状态和下一步恢复动作；不会把未知状态显示成“未安装”。

### 4. 统一错误分类和重试语义

- [x] 定义结构化错误码：账号不存在、账号不可用、SSH 不可达、sudo 失败、包管理器失败、Node/npm/Bun 缺失、安装器失败、CLI 缺失、版本检查失败、daemon 离线等。
- [x] 前端按错误码给出对应的恢复动作，而不是统一显示 SSH 或连接错误。
- [x] 重试前显示会重做哪些远端步骤，避免用户误以为只是重新读取列表。
- [x] 同一 `(computer_id, linux_user)` 的远端安装和升级串行化，避免 npm、包管理器和 daemon refresh 互相干扰。

验收：每一种可恢复错误都有明确文案和可执行动作；不可恢复错误说明需要管理员介入的原因。

## P1：完善 Linux User 和 daemon 管理

### 5. 增加 Linux User 详情页

- [x] 展示 Computer、Linux 用户、绑定工作区、绑定状态、daemon ID、最后检查时间和最近一次操作。
- [x] 展示账号、daemon、CLI 安装和运行时注册四层状态，不把它们合并成一个“在线/离线”字段。
- [x] 管理员可以执行账号检查；用户可以执行同步、升级、重新发现和移除自己的绑定。
- [x] 为 `failed`、`interrupted`、`detached` 和 `removed` 状态提供清晰的后续动作。

验收：用户能区分“账号存在但 daemon 离线”“CLI 已安装但未被发现”“绑定已移除但 Linux User 仍保留”等状态。

### 6. 完善 runtime 资产信息

- [x] 保存目标 Linux User、安装目录、可执行文件路径、请求版本、实际版本、安装器来源和安装时间。
- [x] 版本探测结果标记探测时间和探测环境，不把一次失败覆盖为“未安装”。
- [x] 安装成功后触发 daemon 重新发现，或者明确要求用户点击“重新发现”。
- [x] 区分“未安装”“已安装但版本检查失败”“已安装但 daemon 未发现”“已注册且在线”。

验收：用户可以从页面解释某个 runtime 为什么不可用，并知道应该重装、重新发现还是修复 daemon。

### 7. 明确解绑、删除和孤立账号策略

- [x] 明确“移除 daemon”“解除 binding”“删除 Linux User”“删除历史操作记录”的不同语义和权限。
- [x] 为 `removed`/`detached` binding 提供清理或归档策略，避免历史记录永久阻止 Computer 删除。
- [x] 删除 Linux User 前显示代码、配置、凭据和正在运行任务的影响，并要求显式确认。
- [x] 记录远端删除成功或失败；远端删除失败时保留可恢复状态。

验收：任何删除动作都能回答删除了哪些远端对象、保留了哪些数据，以及失败后如何继续处理。

## P2：扩大环境兼容性和安全性

### 8. 把主机能力探测前置

- [ ] 连接检查返回发行版、包管理器、systemd、PAM、sudo、Node/npm/Bun 和磁盘空间能力。
- [ ] 在 provision 前明确拒绝不支持的发行版，或选择对应的包安装实现。
- [ ] 显示 Node/npm/Bun 来自系统、nvm、asdf、mise 还是其他路径。
- [ ] 生成 daemon unit 时使用显式、可验证的 PATH，不依赖 `.zshrc` 或交互式 shell。

验收：用户在开通前就能知道主机是否满足条件；daemon 的 PATH 与 runtime 探测使用同一套环境定义。

### 9. 加强安装器供应链验证

- [ ] 为第三方安装器记录固定 URL、版本参数、下载时间和 SHA256。
- [ ] 尽量拆分下载、校验和执行，避免无法审计的隐式二次下载。
- [ ] 安装脚本失败时保留受控的错误摘要和退出阶段，不保存敏感环境变量。
- [ ] 为上游安装器变更建立定期核验或版本升级检查。

验收：审计记录能够说明执行了哪个安装器、哪个版本、来自哪里以及校验是否通过。

## P3：后续优化

- [ ] 对远端检查结果做短期缓存和定时健康检查，减少每次打开页面都创建 SSH 连接。
- [ ] 支持用户明确选择已验证的 Node/Bun 私有环境，或在产品文档中正式限定系统工具链支持范围。
- [ ] 评估跨 bastion 部署时的分布式锁和操作幂等性。
- [ ] 评估同一 Linux User 多工作区绑定前，先补齐凭据、daemon profile、运行目录和删除语义。

## 实施顺序

2026-09-25：P0 第 1、3、4 项及 P1 的实现已落地，详见[实施与验收记录](computer-p0-p1-implementation.md)。勾选代表实现完成；功能已随 `b528fd809` 部署，真实主机验收尚未通过；**P0 第 2 项仍待指定非生产主机并执行**。在真实非生产主机验收通过并且远端操作状态可恢复之前，不继续增加新的 runtime 安装器或扩大多工作区绑定模型。

相关设计：[Computer、Linux 用户与运行时设计](../design/computer-runtime-identity-model.md)、[Linux User 与运行时管理归属](../design/linux-user-runtime-management.md)。
