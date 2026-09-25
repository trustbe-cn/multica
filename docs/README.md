# 设计与工程文档

此目录保存面向开发、review 和运维的设计说明及变更记录。面向产品使用者的文档站点源码位于 [apps/docs/content/docs](../apps/docs/content/docs)。中文术语遵循[开发规范](../apps/docs/content/docs/developers/conventions.zh.mdx)。

## Computer 与运行时

| 文档 | 内容 |
| --- | --- |
| [Computer、Linux 用户与运行时设计](design/computer-runtime-identity-model.md) | Multica 用户、工作区、Computer、Linux 用户、守护进程、运行时、智能体和 Admin Area 的关系；权限、绑定生命周期、数据和执行边界。 |
| [Linux User 与运行时管理归属](design/linux-user-runtime-management.md) | Admin Area、我的运行环境和工作区运行时页面的职责划分，以及用户侧 runtime API 的权限边界。 |
| [Computer 与运行时 review 修复记录](engineering/computer-runtime-review-fixes.md) | 两轮 review 的核实结论、最终修复、测试证据、部署状态及尚未验证的事项，对应提交 `e8d97ddc8`。 |
| [Computer provisioning 操作说明](../server/internal/computer/README.md) | 后端配置、目标主机前置条件、PAM 配置和启用前检查。 |

## 其他工程文档

- [任务唤醒机制](engineering/issue-wakeups.md)
- [任务状态生命周期发布说明](issue-status-lifecycle-rollout.md)
- [维护任务](maintenance-jobs.md)
