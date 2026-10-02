# Local API WebSocket Proxy

Windows x64 桌面客户端，可代理多个本地 HTTP API 和 WebSocket。无需安装 Norm 或 Java。

## 安装

解压完整 ZIP，在解压目录打开 PowerShell，运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

从开始菜单打开 **Local API WebSocket Proxy**。首次安装会启用当前用户登录自启和进程守护，右上角“开机启动”可随时切换；关闭自启后仍可从开始菜单打开。更新时先关闭窗口，再运行安装命令，已有配置和开机启动选择会保留。

每条代理填写名称、Control URL（Nfirco 中继的 `role=client` 地址）、Local Base URL，点击连接。不同本地 API 使用不同的中继通道。连接的条目会在下次启动时自动连接；点击断开会取消该条的自动连接。

最小化窗口可继续运行。关闭窗口会正常退出；异常退出后守护进程会重新启动。直接打开 `build/local-api-websocket-proxy.exe` 可以免安装运行；使用开机启动开关时需保留同目录的 `startup.ps1` 和 `supervise.ps1`。

## 远程调用

在调用方电脑安装 Node.js 24.9 或更新版本，在本目录运行：

```powershell
npm ci --omit=dev
npm run gateway -- "wss://YOUR_HOST/ws/proxy/CHANNEL_UUID?role=server" 8765
```

通过 `http://127.0.0.1:8765` 调用原有本地 API 路径。每条代理对应一个 Gateway。

## 配置与记录

安装目录：`%LOCALAPPDATA%/Programs/LocalApiWebSocketProxy/`。配置位于其中的 `proxy.json`。发布包不预置任何代理地址。

每条代理只在内存保存最近 100 条通讯记录，退出后清空。启动诊断日志位于 `%LOCALAPPDATA%/Programs/Norm/logs/local-api-websocket-proxy/`。

卸载自启（保留应用与配置）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

完整协议、CDP 使用方式及源码见 [项目说明](https://github.com/w0fv1/Local-API-WebSocket-Proxy)。
