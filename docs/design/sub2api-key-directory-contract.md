# sub2api API key 目录与模型探测契约

状态：已验证 .64 的目录、resolve 和模型列表读取；目录与 resolve 均已返回 `platform`、`protocols`（2026-10-27 补齐）。真实 CLI 生成测试仍需单独验收。对应产品方案见[运行时模型配置方案](runtime-model-configuration.md)。示例不含可用凭据。

## 1. 来源与凭据

- 实例保存一份查询凭证，绑定一个拥有全部待分配 key 的 sub2api 用户。
- 来源地址为 `https://tianshu-64.base.trustbe.cn`。其他部署使用管理员配置的来源。
- `DIRECTORY_TOKEN` 只用于目录及 resolve，不能用于模型接口。
- `api_key_token` 是模型凭据，用于模型列表探测及用户授权的 CLI 配置。
- 查询凭证加密保存；模型 token 不写数据库、目录缓存、日志或操作任务载荷。用户明确允许其写入本人 Linux 私有配置文件。

## 2. 目录

```http
GET /api/v1/key-directory?page=1&page_size=100
Authorization: Bearer <DIRECTORY_TOKEN>
```

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "id": 123,
        "api_key_name": "example-key",
        "status": "active",
        "platform": "openai",
        "protocols": ["openai_responses", "openai_chat_completions"]
      }
    ],
    "page": 1,
    "page_size": 100,
    "total": 1,
    "pages": 1
  }
}
```

目录字段均已核对真实响应。Multica 不依赖 `code`、`message`、`pages` 判断分页完整性，按 HTTP 状态和 `data` 契约处理。

| 字段 | 约定 |
| --- | --- |
| `id` | 精确整数；浏览器侧转为十进制字符串。ID 在同一来源内唯一、稳定，不按名称绑定。 |
| `api_key_name` | 可重名；resolve 同时发送名称和 ID。 |
| `status` | 实际接口为 `active` / `inactive`；Multica 边界转换为 `enabled` / `disabled`。未知值禁止新配置。 |
| `platform` / `protocols` | 与 resolve 保持一致。Multica 按平台、声明协议和已实现 runtime 适配器的交集计算兼容范围，不再要求逐 key 的 runtime 授权列表。 |
| 分页 | 每页最多 100，`total` 必须一致；拒绝重复 ID 和缺页。 |

runtime 标识：`claude`、`codex`、`opencode`、`openclaw`、`grok`、`kimi`、`omp`、`pi`。

`platform` 实测值包括 `anthropic`、`openai`、`grok`、`gemini`、`deepseek`、`zhipu` 和空字符串。已确认采用平台与协议兼容筛选，不再要求 sub2api 的 `allowed_runtimes`。未知 / 空平台无可选 runtime；已支持平台缺少协议字段属于不完整元数据。管理员的 User-key 分配仍是权限边界。

| 平台 / 声明协议 | 当前实现的兼容 runtime |
| --- | --- |
| `anthropic` / `anthropic_messages` | Claude、OpenClaw、OMP、Pi |
| `openai` / `openai_responses` | Codex、Grok、OpenClaw、OMP、Pi |
| `openai` / `openai_chat_completions` | OpenCode、Kimi、Grok、OpenClaw、OMP、Pi |
| `grok` / `openai_chat_completions` | Grok |
| `deepseek` / `openai_chat_completions` | OpenCode、Pi |
| `gemini` / `gemini_generate_content` | Pi（`google-generative-ai`，端点为根地址 + `/v1beta`，认证 `x-goog-api-key`） |
| `zhipu` / 任意 | 无（暂不支持） |

厂商平台（grok、deepseek、gemini）只开放给上表列出的 CLI，即使其他 CLI 也支持同一协议。Gemini key 的模型列表走 `/v1/models`：sub2api 的原生 `/v1beta/models` 会列出该分组实际无法路由的模型，`/v1/models` 只返回可用模型。

一把 key 声明多个受支持协议时合并兼容范围。平台与协议相互矛盾时不扩大范围。Multica 内部及已有浏览器 API 的 `allowed_runtimes` 字段承载这份计算结果，保持 API 响应兼容；它不再表示上游逐 key 的 ACL。

目录只有元数据。Multica 完整分页获取后在服务端搜索及分页展示；不会为搜索目录而逐个 resolve token。

## 3. resolve

```http
POST /api/v1/key-directory/resolve
Authorization: Bearer <DIRECTORY_TOKEN>
Content-Type: application/json

{"api_key_name":"example-key","id":123}
```

```json
{
  "data": {
    "id": 123,
    "api_key_name": "example-key",
    "status": "active",
    "api_key_token": "<MODEL_API_KEY>",
    "base_url": "https://tianshu-64.base.trustbe.cn",
    "expires_at": null,
    "platform": "openai",
    "protocols": ["openai_responses", "openai_chat_completions"],
    "model_names": null
  }
}
```

- 必须返回匹配的 ID、名称和当前状态；Multica 在 resolve 前后校验本地分配和实时平台 / 协议兼容范围。
- `model_names` 不再是必填字段，也不承担模型选择授权语义；模型列表由模型服务探测。
- 不再要求上游提供 `models`、`endpoints` 或默认模型。
- 实测 `inactive` key 也可能返回 HTTP 200 和 token；Multica 必须检查状态并拒绝配置，不能只看 HTTP 200。
- `platform` 参与兼容筛选，`type` 不参与权限判定；不根据 key 名称猜平台或协议。
- `protocols` 必须是明确的已支持协议列表；空值不能视为支持全部协议。

| 上游协议 | Multica 内部协议 | CLI / SDK 使用的基础地址 |
| --- | --- | --- |
| `anthropic_messages` | `anthropic-messages` | 服务根地址 |
| `openai_responses` | `openai-responses` | 服务根地址 + `/v1` |
| `openai_chat_completions` | `openai-chat-completions` | 服务根地址 + `/v1` |

`base_url` 是统一 HTTPS 服务根地址，不是 `/responses` 等完整端点。当前约定不接受带业务路径、凭据、查询参数或 fragment 的地址。上述 `/v1` 处理是协议适配规则，管理员不需要为每个 runtime 重复填写不同来源。

## 4. 模型探测

取得模型凭据后先读取模型列表，用户选择模型后生成配置，再进行真实 CLI 连接测试。获取列表本身不需要先调用模型生成回复，不会形成“必须先选模型才能探测模型”的循环。

OpenAI 协议：

```http
GET /v1/models
Authorization: Bearer <MODEL_API_KEY>
```

Anthropic 协议：

```http
GET /v1/models
x-api-key: <MODEL_API_KEY>
anthropic-version: 2023-06-01
```

```json
{
  "data": [
    {"id":"example-model","display_name":"Example model"}
  ],
  "object": "list"
}
```

- 读取 `data[].id` 和可选 `display_name`；没有显示名时 UI 使用 ID。
- 相同认证方式的 OpenAI Responses / Chat Completions 共用一次模型列表请求。Anthropic 独立使用其认证头；若返回 `has_more` 和 `last_id`，按 `after_id` 分页。
- 相同模型 ID 可以合并其探测来源对应的协议；这只是候选范围，不能证明每个模型都支持聊天、工具或所有声明协议。真实 CLI 回复测试才是所选组合的连接验证。
- 列表可能包含图像、保留模型或其他非 CLI 候选，不能只凭列表成功宣称全部可用，也不通过名称猜测并隐藏它们。
- 空列表、重复 ID、格式错误、分页循环、认证失败、限流均返回结构化错误；不自动编造默认模型。
- 默认模型来自管理员模板；未设置或不在候选列表时要求用户选择。安装时遇到该情况标记待配置，不影响安装结果。
- 模型探测只使用本次 resolve 的模型 token，按需执行，不持久缓存 token。目录查询凭证不得发给 `/v1/models`。
- 查询客户端拒绝重定向，不记录原始响应或错误正文。

已使用实际 key 验证上述两种模型列表请求均返回 HTTP 200；这一证据不代表真实 CLI 或模型生成已验收。

## 5. 缓存、失败和撤销

目录正常快照有效期为 60 秒。并发刷新合并为一次请求，等待者可以取消。失败也进入至少 60 秒冷却，429 遵守 `Retry-After`，冷却上限为 15 分钟；管理员强制刷新可绕过缓存和冷却。保留上一次完整元数据快照，但错误状态不作为当前可用授权放行。

| HTTP 状态 / 情况 | 处理 |
| --- | --- |
| 401 查询凭证失效 | 管理员替换凭证；不把错误响应正文返回页面 |
| 403 / 404 / 409 | 明确 key 禁止、缺失或重名；不改用另一把 key |
| 429 | 冷却并提示重试；不自动重放模型生成请求 |
| 模型列表 401 / 403 | 提示模型认证失败，区别于目录凭证失效 |
| 5xx / 网络失败 | 保留已有 Linux 文件，返回脱敏错误 |
| 撤销本地分配 | 列表和编辑器标记授权失效，拒绝新 resolve；不删除用户私有文件 |
| 更换来源地址 | 清除目录、分配和配置的旧 key 引用，避免相同 ID 误指向新来源的其他 key |
| token 轮换 | 重新 resolve、预览和保存；旧预览保存被拒绝 |

用户持有已交付的模型 key。若要撤销其在 Multica 之外的调用，须由 sub2api 禁用或轮换模型 key，本地分配撤销不能追回已交付的秘密。

## 6. 剩余联调

1. 目录每条记录补齐与 resolve 一致的 `platform`、`protocols`，验证完整目录过滤，不批量 resolve token。
2. 验证多协议、平台 / 协议不匹配、未知平台、禁用 key 和分配撤销的行为。
3. 对八种 CLI 的目标版本逐个验收配置字段、显式模型选择、路径和实际回复；测试使用专用账号及明确授权。

开发期间不把凭据写入本文件、fixture、仓库或共享调试文件。
