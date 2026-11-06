# 代理管理 API

桌面版可选启用一个仅监听 `127.0.0.1` 的 HTTP 服务，管理当前桌面进程里的业务代理。Micronaut Web 提供路由，DI 容器持有管理服务，控制器通过注入取得该服务。命令分派到桌面视图线程，和界面按钮共享连接、持久化与重连逻辑。

在桌面 EXE 的目录创建 `management.json`，设置 port、token 和 controlUrl。token 使用本机生成的至少 32 个字符的随机密钥。controlUrl 填独立管理中继的 Client 地址，留空则仅支持本机 HTTP 调用。未配置文件时不启动管理 API；该密钥仅用于这台代理，不能使用 Userver 的 adminSecret。

```json
{"port":18767,"token":"<替换为随机密钥>","controlUrl":"wss://<Userver>/ws/proxy/<管理通道 UUID>?role=client"}
```

每个请求都携带 `Authorization: Bearer <管理密钥>`。

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | /v1/proxies | 业务代理 ID、名称、状态和启用标志 |
| POST | /v1/proxies/{id}/connect | 启动连接后观察到的状态 |
| POST | /v1/proxies/{id}/disconnect | 发起断开后的状态 |
| POST | /v1/proxies/{id}/reconnect | 发起重新连接后的状态 |

连接、断开和重连是异步动作。通过 GET 再次查看状态；重连等待旧连接任务退出后才建立新连接。返回 401 表示管理密钥无效，404 表示 ID 不存在。接口只管理已在桌面配置好的代理。

远程调用时，用现有 Gateway 连接同一管理通道的 Server 地址，转发上述 HTTP 请求和请求头。管理中继固定转发到本机管理端口，不接受 WebSocket 隧道。业务连接关闭后管理中继继续运行。桌面进程整体退出后恢复由现有 Windows 守护任务负责。

