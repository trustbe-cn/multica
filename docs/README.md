# 设计与工程文档

此目录保存面向开发、review 和运维的设计说明及变更记录。面向产品使用者的文档站点源码位于 [apps/docs/content/docs](../apps/docs/content/docs)。中文术语遵循[开发规范](../apps/docs/content/docs/developers/conventions.zh.mdx)。

## Computer 与运行时

| 文档 | 内容 |
| --- | --- |
| [Computer、Linux 用户与运行时设计](design/computer-runtime-identity-model.md) | Multica 用户、工作区、Computer、Linux 用户、守护进程、运行时、智能体和 Admin Area 的关系；权限、绑定生命周期、数据和执行边界。 |
| [Linux User 与运行时管理归属](design/linux-user-runtime-management.md) | Admin Area、我的运行环境和工作区运行时页面的职责划分，以及用户侧 runtime API 的权限边界。 |
| [Computer 与运行时 review 修复记录](engineering/computer-runtime-review-fixes.md) | 两轮 review 修复与历史验证，以及 `07f1e09c4`、`b528fd809` 的部署记录；保留尚未验证的事项。 |
| [Computer provisioning 操作说明](../server/internal/computer/README.md) | 后端配置、目标主机前置条件、PAM 配置和启用前检查。 |
| [Computer、Linux User 与运行时 TODO](engineering/computer-linux-user-runtime-todo.md) | 下一阶段的可靠性、真实主机验收、操作状态、资产信息和环境兼容性工作清单。 |

- [远端操作、资产与清理设计](design/computer-remote-operations.md)：操作状态、错误恢复、四层状态、异步兼容和删除边界。
- [P0/P1 实施与验收记录](engineering/computer-p0-p1-implementation.md)：实现范围、本地测试环境和真实验收缺口。
- [部署记录模板](engineering/computer-deployment-template.md)：镜像、迁移、健康证据与回滚记录。

- [Computer、Linux 用户与运行时验收](engineering/computer-runtime-acceptance.md)：页面、权限、安装和生命周期验收步骤，以及隔离故障测试的边界。

## 其他工程文档

- [任务唤醒机制](engineering/issue-wakeups.md)
- [任务状态生命周期发布说明](issue-status-lifecycle-rollout.md)
- [维护任务](maintenance-jobs.md)
