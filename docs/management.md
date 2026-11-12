# 代理管理 API

桌面版可选启用一个仅监听 `127.0.0.1` 的 HTTP 服务，管理当前桌面进程里的业务代理。Micronaut Web 提供路由，DI 容器持有管理服务，控制器通过注入取得该服务。命令分派到桌面视图线程，和界面按钮共享连接、持久化与重连逻辑。

在桌面 EXE 的目录创建 `management.json`。填写本机监听端口、Userver 服务地址和 Userver 后台配置的管理通道 UUID。Userver 服务地址使用 HTTPS，本机开发可用 `http://127.0.0.1:端口`。未配置文件时不启动管理 API。

```json
{"port":18767,"userverUrl":"https://userver.example.com","channelUuid":"<管理通道 UUID>","apiKey":"<Userver 平台 API Key>"}
```

`apiKey` 用于桌面与管理中继的 WebSocket 握手。省略该字段时，仅启用本机 HTTP 管理。控制请求使用自己的 `Authorization: Bearer <平台 API Key 或 Userver 管理员登录 Token>`，每次由 Userver 验证身份和管理通道。

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | /v1/proxies | 业务代理 ID、名称、状态和启用标志 |
| POST | /v1/proxies/{id}/connect | 启动连接后观察到的状态 |
| POST | /v1/proxies/{id}/disconnect | 发起断开后的状态 |
| POST | /v1/proxies/{id}/reconnect | 发起重新连接后的状态 |

连接、断开和重连是异步动作。通过 GET 再次查看状态。重连等待旧连接任务退出后才建立新连接。401 表示凭据无效，403 表示无管理权限，404 表示代理 ID 不存在，503 表示 Userver 鉴权暂不可用。接口只管理当前桌面进程配置的代理。

远程调用使用 Userver 的管理 HTTP API 或 MCP。管理中继固定转发到本机管理端口，拒绝 WebSocket 隧道。业务连接关闭后管理中继继续运行。桌面进程整体退出后由 Windows 守护任务恢复。

