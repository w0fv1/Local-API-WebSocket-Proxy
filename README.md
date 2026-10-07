# Local API WebSocket Proxy

Windows 桌面客户端通过 Nfirco RELAY 通道转发本机 HTTP API 和 WebSocket。桌面界面使用 [ui.desktop.kit](https://github.com/normlanguage/ui.desktop.kit) 组件库与 [Norm UI](https://github.com/normlanguage/ui) 的 [ui.desktop](https://github.com/normlanguage/ui.desktop) JavaFX 实现，网络请求由 Norm 进程执行。

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

桌面安装包发布在 [GitHub Releases](https://github.com/w0fv1/Local-API-WebSocket-Proxy/releases) 与 [火合网](https://next.firco.cn/release/local-api-websocket-proxy)。版本 tag 发布入口见 [工作流](.github/workflows/release.yml)，发布说明见 [RELEASE.md](RELEASE.md)。

模块依赖以 [桌面模块清单](src/localapi/desktop/module.norm) 为准，可复现的源码版本统一固定在 [build-dependencies.json](build-dependencies.json)。[构建入口](build-ci.ps1) 获取锁定源码、构建匹配编译器，并依次准备主题、通用 UI、桌面后端和桌面组件库。应用的布局来自 `ui`，控件来自 `ui.desktop.kit`，主题来自 `ui.theme`；生命周期约定见[应用开发文档](https://github.com/normlanguage/ui.desktop.kit/blob/main/docs/applications.md)。

构建与检查使用本项目 `.norm-home` 隔离缓存，不复制库实现。`NORM_EXECUTABLE` 指向匹配编译器，[scripts/norm.ps1](scripts/norm.ps1) 统一设置应用缓存位置。首次准备完整源码依赖并构建桌面与命令行代理：

```powershell
$env:JAVA_HOME = '你的 JDK 25 安装目录'
$env:THEME_JAVA_HOME = '你的 JDK 21 安装目录'
.\build-ci.ps1
$env:NORM_EXECUTABLE = Join-Path $PWD '.tmp/dependencies/Norm/build/compiler/norm-runtime/bin/norm.bat'
.\scripts\norm.ps1 check src/localapi/desktop
.\scripts\norm.ps1 test src/localapi/desktop --filter localapi.desktop.test.components
npm ci
node --test test/agent.test.mjs
.\test\desktop-smoke.ps1
```

仅准备源码依赖使用 `./build-ci.ps1 -PrepareOnly`。依赖准备完成后，单独重建使用 `./build.ps1 -NormExecutable scripts/norm.ps1`；命令行代理加 `-Target Agent`。全部依赖正式发布后，也可将已安装的匹配版 Norm 命令传给 `-NormExecutable`，由模块声明解析 GitHub 包。

桌面产物是 Native Image 窗口模式 EXE，不携带 JVM，运行电脑无需安装 Norm 或 Java。`-Target Agent` 构建原生命令行代理，启动时读取工作目录的 `proxy.json`，供自动化验证和无界面使用。构建日志写入仓库 `.tmp/local-api-proxy-build`；桌面启动日志由启动器写入 `%LOCALAPPDATA%/Programs/Norm/logs/local-api-websocket-proxy/`。

[端到端测试](test/agent.test.mjs) 启动真实 HTTP、WebSocket 和模拟 RELAY 服务，通过构建好的代理 EXE 验证字节保真、分块、并发、取消及重连；模拟中继不等同于生产环境验收。

[桌面测试](test/desktop.test.mjs) 需要 Windows 交互会话，验证多代理隔离、心跳超时、批量操作和配置恢复。[界面测试](test/appearance.test.mjs) 验证窗口缩放后的布局、状态和真实自启开关。[启动测试](test/startup.ps1) 注册临时计划任务，验证自启选择、手动启动与异常退出恢复，并清理临时任务。

[组件验收](src/localapi/desktop/tests/test/components/case.norm) 在真实 JavaFX 窗口中验证条目身份、原生输入绑定及连接校验，不操作开机启动、不连接生产中继。`npm test` 包含完整桌面与自启验收，需要专门的 Windows 测试环境；日常依赖升级使用上面的定向命令。

[原生启动验收](test/desktop-smoke.ps1) 在独立目录运行实际桌面 EXE，验证启动、新增条目及正常退出，不保存代理配置、不修改自启任务。

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
