# Linux User 与运行时管理归属

本文定义 Computer、Linux User 与 CLI runtime 的产品入口和权限边界。它补充
[Computer、Linux 用户与运行时设计](computer-runtime-identity-model.md)。

## 结论

- **Admin Area → Computers** 只管理实例级 Computer：登记、连接检查、启用/停用、删除（无绑定时）。
- **Admin Area → Linux Users** 管理托管绑定的运维视图：查看 Computer、Linux 用户、所属 Multica User、工作区、状态和错误；不提供普通 runtime 安装入口。
- **设置 → 我的运行环境** 是 Multica 用户管理自己 Linux User 的主入口：创建/复用、同步、升级、移除，以及在该账号环境中探测和安装 CLI runtime。
- 工作区的 **运行环境** 页面继续管理 daemon 注册的 `agent_runtime`、共享范围和 Agent 可用性；它不负责在主机上安装 CLI。

## 资源与权限

用户侧 runtime 请求以 `computer_binding_id` 为边界，不接受任意 `linux_user`。服务端从当前用户拥有的绑定解析 Computer 和 Linux 用户，再使用 Computer 的 SSH operator 通过 `sudo/runuser` 执行。这样同一台 Computer 上的多个 Linux 用户不会混淆，也不会因为知道用户名而越权。

建议接口：

| 接口 | 用途 | 授权 |
| --- | --- | --- |
| `GET /api/me/computer-bindings/{id}/runtimes` | 探测绑定对应 Linux User 的 CLI | 当前用户拥有该绑定 |
| `POST /api/me/computer-bindings/{id}/runtime-install` | 安装或更新 CLI | 当前用户拥有该绑定，绑定处于可操作状态 |
| `GET /api/admin/computer-bindings` | 查看 Linux User 绑定列表 | 实例管理员 |
| `POST /api/admin/computer-bindings/{id}/check` | 检查绑定对应的 Linux 账号是否仍存在 | 实例管理员 |

管理员可以查看 Linux User 的状态和故障信息，并通过绑定级检查接口确认远端账号是否仍存在，但不通过 Computer 页面代替用户安装 runtime。需要运维介入时，应增加明确命名的诊断/修复接口，并单独记录审计；它不应成为普通安装流程。

## 页面结构

```text
Admin Area
├── Computers
└── Linux Users

设置
└── 我的运行环境
    ├── Computer + Linux User 绑定
    └── 绑定内的 CLI runtimes
```

“我的运行环境”按绑定展示，每一行包含 Computer 名称、Linux 用户名、工作区和状态。展开绑定后显示 runtime 版本、探测错误和安装/更新控件。用户不需要再次输入 Linux 用户名。

## 生命周期

创建或复用 Linux User 仍走现有 `/api/me/computer-bindings` provisioning 流程。绑定成功后，runtime 安装不改变绑定状态，只写入该 Linux User 的 home/private prefix，并在完成后重新探测版本。移除绑定仍由现有 provisioning 操作负责；runtime 列表在绑定被移除或不可用时不展示安装操作。

Admin runtime 探测与安装接口已移除。用户侧接口始终从绑定解析目标 Linux User，不接受任意用户名。
