# Local API WebSocket Proxy

Windows 桌面客户端通过 Nfirco RELAY 通道转发本机 HTTP API 和 WebSocket。桌面界面使用正式 [ui.kit](https://github.com/normlanguage/ui-component) 组件库与 [Norm UI](https://github.com/normlanguage/ui) 的 [ui.fx](https://github.com/normlanguage/ui-fx) JavaFX 实现，网络请求由 Norm 进程执行。

```text
远程调用方 → 远程 Gateway → Nfirco RELAY ← 本机桌面客户端 → 本地 HTTP API / CDP
```

一个桌面客户端可以管理多个本地 API。每条代理使用独立的 RELAY 通道和 Gateway；多个调用方可以共用同一个 Gateway。协议不包含业务 adapter，不改写 API 响应。

## 使用

1. 在 Nfirco 后台建立连接中继，复制 Client、Server 地址。中继需将同一通道 Client 和 Server 端的 WebSocket 消息双向透明转发；用于本地验证的中继实现见 [测试服务](test/fixture.mjs)。
2. 在本机打开 `build/local-api-websocket-proxy.exe`，新增代理并填写名称、Client 地址（Control URL）、实际 Local Base URL，例如 `http://127.0.0.1:54345`，点击连接。其他本地 API 分别添加独立条目。
3. 在远程调用方所在电脑安装 Node.js 24.9 或更新版本，在本目录运行：

```powershell
npm ci
npm run gateway -- "wss://YOUR_HOST/ws/proxy/CHANNEL_UUID?role=server" 8765
```

界面显示“已就绪”后，通过 `http://127.0.0.1:8765` 调用本地 API 原有路径，保留原有方法、请求头和请求体。Gateway 仅监听其所在电脑的回环地址。

CDP 是浏览器调试用的 WebSocket 协议。取得本地 API 返回的 CDP 地址后，将其中的端口和路径传给 Gateway；例如本地地址 `ws://127.0.0.1:9222/devtools/browser/ID` 对应：

```text
ws://127.0.0.1:8765/__ws?port=9222&path=%2Fdevtools%2Fbrowser%2FID
```

WebSocket 始终连接 Local Base URL 的主机，允许指定动态端口。当前不协商 WebSocket 子协议。HTTP 请求体、响应体及单条 WebSocket 消息上限为 8 MiB；长时间 HTTP 流不在支持范围内。容量和超时以 [Gateway](gateway/gateway.mjs) 与 [传输实现](src/localapi/proxy/transfer.norm) 为准。

连接配置保存在 EXE 同目录的 `proxy.json`，结构见 [ProxySettings](src/localapi/proxy/settings.norm)。桌面操作见 [ProxyWindow](src/localapi/desktop/application.norm)，连接状态见 [ProxyStatus](src/localapi/desktop/state.norm)，生命周期见 [ProxyEntry](src/localapi/desktop/entry.norm)。

安装登录自启与进程恢复：

```powershell
.\install.ps1
```

应用安装到 `%LOCALAPPDATA%/Programs/LocalApiWebSocketProxy/`。右上角“开机启动”控制当前用户登录触发器，关闭后仍可使用开始菜单启动。任务注册、查询与切换统一由 [startup.ps1](startup.ps1) 维护，桌面入口为 [StartupToggle](src/localapi/desktop/startup.norm)。`startup.json` 仅保存安装所用的任务名称；开关状态以 Windows 计划任务为准。更新时先正常关闭窗口再运行安装脚本；已有配置和开机启动选择保留。卸载自启使用 `./install.ps1 -Uninstall`，保留应用和配置文件。进程恢复见 [supervise.ps1](supervise.ps1)。

通讯记录仅保留在内存中，每条代理独立保留收发合计最近 100 条，按时间从旧到新排列，退出程序后清空。每条包含时间戳、方向和完整原始消息，可用 `session`、`id` 关联往返。分块消息每块计一条；心跳和分块确认不计入。手动断开、重新连接会保留记录，删除代理清空该条记录；读取入口为 [CommunicationHistory.snapshot](src/localapi/proxy/history.norm)。

## 构建与验证

发布包使用说明见 [安装与运行](DISTRIBUTION.md)。构建并验证后，运行 `./package-release.ps1 -Version <版本号>` 生成 Windows ZIP 与 SHA-256，输出到仓库 `.tmp/local-api-proxy-releases`。

桌面安装包发布在 [GitHub Releases](https://github.com/w0fv1/Local-API-WebSocket-Proxy/releases)，标签为 `v<版本号>`，附件包含 ZIP 与 SHA-256。版本说明见 [RELEASE.md](RELEASE.md)。使用 GitHub CLI 发布：`gh release create v<版本号> .tmp/local-api-proxy-releases/local-api-websocket-proxy-<版本号>-windows-x64.zip .tmp/local-api-proxy-releases/local-api-websocket-proxy-<版本号>-windows-x64.sha256 --notes-file RELEASE.md`。

依赖以 [桌面模块清单](src/localapi/desktop/module.norm) 为准。当前 `ui.kit` 及其所有权契约需要匹配的开发版 Norm，现有 Release 尚不能满足全部依赖。使用 JDK 25 从 [Norm 源码](https://github.com/normlanguage/Norm) 构建 `:compiler:installRuntimeDist`，按 [ui.kit 构建入口](https://github.com/normlanguage/ui-component#readme) 准备已合并的依赖源码和主题 Java 制品，运行其 `scripts/prepare.ps1`。依赖 checkout 不在同级目录时，传入该脚本对应的 Root 参数。

构建与检查复用 ui.kit 的隔离开发目录，不复制库实现到本项目。`NORM_EXECUTABLE` 指向匹配的编译器，`-NormExecutable` 指向 kit 的包装脚本；两者职责不同。

```powershell
$kitRoot = '你的 ui-component checkout 绝对路径'
$env:NORM_EXECUTABLE = '匹配版 Norm checkout/build/compiler/norm-runtime/bin/norm.bat'
$kitNorm = Join-Path $kitRoot 'scripts/norm.ps1'
& (Join-Path $kitRoot 'scripts/prepare.ps1')
.\build.ps1 -NormExecutable $kitNorm
.\build.ps1 -NormExecutable $kitNorm -Target Agent
npm ci
npm test
.\test\startup.ps1
```

全部依赖正式发布后，可直接将已安装的匹配版 Norm 命令传给 `-NormExecutable`，由模块声明解析 GitHub 包。

桌面产物是 Native Image 窗口模式 EXE，不携带 JVM，运行电脑无需安装 Norm 或 Java。`-Target Agent` 构建原生命令行代理，启动时读取工作目录的 `proxy.json`，供自动化验证和无界面使用。构建日志写入仓库 `.tmp/local-api-proxy-build`；桌面启动日志由启动器写入 `%LOCALAPPDATA%/Programs/Norm/logs/local-api-websocket-proxy/`。

[端到端测试](test/agent.test.mjs) 启动真实 HTTP、WebSocket 和模拟 RELAY 服务，通过构建好的代理 EXE 验证字节保真、分块、并发、取消及重连；模拟中继不等同于生产环境验收。

[桌面测试](test/desktop.test.mjs) 需要 Windows 交互会话，验证多代理隔离、心跳超时、批量操作和配置恢复。[界面测试](test/appearance.test.mjs) 验证窗口缩放后的布局、状态和真实自启开关。[启动测试](test/startup.ps1) 注册临时计划任务，验证自启选择、手动启动与异常退出恢复，并清理临时任务。

## 代码入口

| 职责 | 入口 |
| --- | --- |
| 桌面与配置 | [application.norm](src/localapi/desktop/application.norm) |
| 单条代理运行状态 | [entry.norm](src/localapi/desktop/entry.norm) |
| 多代理配置模型 | [settings.norm](src/localapi/proxy/settings.norm) |
| Windows 自启与保活 | [startup.norm](src/localapi/desktop/startup.norm)、[startup.ps1](startup.ps1)、[install.ps1](install.ps1)、[supervise.ps1](supervise.ps1) |
| 桌面状态 | [state.norm](src/localapi/desktop/state.norm) |
| 连接生命周期 | [application.norm](src/localapi/proxy/application.norm) |
| 协议与目标地址 | [protocol.norm](src/localapi/proxy/protocol.norm) |
| 会话与操作调度 | [session.norm](src/localapi/proxy/session.norm) |
| 有界通讯记录 | [history.norm](src/localapi/proxy/history.norm) |
| HTTP、分块与 WebSocket | [transfer.norm](src/localapi/proxy/transfer.norm) |
| 远程 HTTP / WebSocket 入口 | [cli.mjs](gateway/cli.mjs) |

## 许可证

[MPL-2.0](LICENSE)

## 自动发布

版本入口为 [package.json](package.json)，构建依赖固定在 [build-dependencies.json](build-dependencies.json)。[发布工作流](.github/workflows/release.yml) 在版本 tag 上构建并双端发布；PR 仅构建与验证。

