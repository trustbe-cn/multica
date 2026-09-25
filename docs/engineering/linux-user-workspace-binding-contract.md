# Linux 用户接入契约判定

本表是[协作方案](../design/linux-user-workspace-collaboration-plan.md)任务 1 的实现依据。它描述当前 `claimComputerBindingSQL` 和用户侧接口的行为；界面候选资格只是提示，最终仍由服务端事务判定。

| 账号记录 | 目标工作区 | 接入判定 | 用户下一步 |
| --- | --- | --- | --- |
| 本人已验证，`removed` 或 `detached` | 新工作区 | 可通过 `provision` 重新开通；须确认 Computer、凭据、账号状态且没有进行中的操作。 | 选择账号并输入 Linux 密码；`detached` 不代表远端账号仍存在。 |
| 本人已验证，其他状态且未运行操作 | 原工作区 | 可以按现有接口重试或同步；不是跨工作区迁移。 | 在原工作区处理失败或离线状态。 |
| 本人已验证，其他状态 | 新工作区 | 不可直接接入。`failed` 不表示旧绑定已解除。 | 在原工作区移除受管 daemon，确认变为 `removed` 后再接入；原工作区的执行能力会中断。 |
| 本人账号，`running` 或有排队/运行中的操作 | 任意工作区 | 不可启动重叠远端操作。 | 等待完成；超时后按操作记录恢复或确认。 |
| 其他人已验证的同机同名账号 | 任意工作区 | 不可接管。唯一键是 `(computer_id, username)`。 | 换一个 Linux 用户名或联系管理员；不显示账号所有者。 |
| 未验证的 `failed` 记录 | 任意工作区 | 不是已拥有的账号；当前 SQL 允许重新认领，但必须通过 Linux 密码校验。 | 按新账号流程开通，不能在已有账号列表中承诺可直接复用。 |
| 已归档账号 | 任意工作区 | 当前列表不返回；SQL 可在允许的状态下清除归档标记。 | 本阶段不作为普通候选，先确认恢复语义。 |

客户端还须先确认目标工作区已创建、当前用户是成员、Computer 可用、个人凭据已保存且 PAT 属于本人。`account_state='missing'` 不是独立的所有权判定；远端账号可能需要重新创建。服务器继续验证这些条件，不能只信前端选择器。

实现中的 `GET /api/me/computer-bindings` 增加 `verified`、`account_state` 和 `operation_busy`。旧服务端缺少字段时，客户端分别回退为 `false`、`unknown` 和 `false`，不能把缺失的 `verified` 解释成可复用。`POST /api/me/computer-bindings` 的冲突响应增加 `username_unavailable`、`operation_busy`、`binding_workspace_conflict` 和 `binding_conflict` 错误码；同名占用不暴露其他所有者身份。并发下仍以服务端事务结果为准。真实数据库冲突测试尚未执行，不能仅凭 Go 编译和界面测试认定这条契约已验收。

Web 的新建工作区入口是 `/workspaces/new`；Desktop 用 `WindowOverlay` 承载新建流程。两端创建成功后继续进入现有运行时步骤，退出 overlay 后才能在目标工作区内展示可选接入提示。跳过运行时时，先处理 `WelcomeAfterOnboarding`，再显示接入提示，不能同时抢占焦点。跳过后从工作区设置的 Linux 用户标签重新进入，个人设置的“我的运行环境”仍用于管理账号、凭据、CLI 和操作记录。
