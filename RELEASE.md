---
version: 0.4.0
---

# Local API WebSocket Proxy

0.4.0 更新：升级 UI 依赖与原生运行时，修复 Windows 辅助功能 JNI 回调缺失导致的桌面崩溃，以及异常 JSON 导致转发进程退出的问题；补齐 HTTP / CDP 传输与桌面组件回归测试。构建使用隔离缓存，并校验原生元数据。

Windows x64 桌面客户端，可通过 Nfirco 中继远程访问多个本地 HTTP API 和 WebSocket，无需安装 Norm 或 Java。

- 支持独立管理通道和本机 HTTP 管理接口，可查看代理状态以及连接、断开和重连。设置见 docs/management.md。
- 每条代理使用独立中继通道，支持单条及批量连接、断开。
- 右上角控制 Windows 登录自启，支持心跳检测、断线重连和异常退出恢复。
- 卡片右上角显示连接状态，卡片样式区分连接、等待和失败状态。
- 每条代理仅在内存保存最近 100 条通讯记录。

解压完整 ZIP，在解压目录打开 PowerShell 并运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

从开始菜单打开 **Local API WebSocket Proxy**，点击右下角“新增”，填写代理名称、Control URL（中继的 `role=client` 地址）和 Local Base URL。点击“保存”保存配置，在卡片右下角连接、断开或删除代理。最小化可继续运行；正常关闭窗口则退出。

发布包包含原生 EXE、安装与守护脚本、远程 Gateway 和完整使用说明，不预置代理地址。远程 Gateway 需要 Node.js 24.9 或更新版本。
