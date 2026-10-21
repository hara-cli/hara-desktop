# Hara Desktop 1.1.0 — announcement draft / 公告草稿

Draft release copy. [Release notes](RELEASE_NOTES_1.1.0_DRAFT.md).

## 中文正文

[Hara] Hara Desktop 1.1.0 带来全新工作空间和本机个人频道：

- 工作区铺满窗口，去掉外层留白与卡片边框；浅色、深色均适配，并为 macOS 红绿灯留出位置。
- 界面默认跟随系统语言，也可在“外观与语言”中手动选择简体中文、繁体中文或 English。
- 在当前工作空间创建本机频道，添加多位同事，选择全部或部分同事回复，也可只保存笔记。无需登录云端，频道记录存于本机当前 Workspace；同事回复使用你配置的模型连接。
- 开关保持圆角胶囊外形，修复背后的方形色块；本机网页预览在聊天右侧展开，加宽、还原或关闭时保留聊天和草稿。

**从 Desktop 1.0.3 升级**：设置 → 应用与更新 → 检查更新，按提示下载、确认重启；升级后该页为“软件更新”。升级前结束进行中的工作并保留可恢复的数据备份。

内置引擎的版本标签仍为 **1.0.2**，包含本版所需的本机频道扩展；这与独立发布的 Core/CLI 1.0.2 内容不同。桌面版无需另装 npm 或 Pi，也不要用单独安装的旧版引擎替换内置引擎。

**Mac 下载**：在正式版本的下载页选择 Apple Silicon 或 Intel 对应安装包。

已知范围：本版邀请他人为占位，不承诺上线时间。当前频道面向本工作空间的同事；本机浏览器预览暂不提供通用网页浏览或 Chrome 配对。

升级后请优先确认原 Workspace 的同事、历史、定时任务和模型连接，再试一次新建频道、深浅主题与右侧预览。Intel 用户请注明实际机型和是否在物理 Intel 上运行。遇到问题请附 Desktop 版本、机型/macOS、主题/语言、复现步骤及截图，回原反馈线程。

## English copy

[Hara] Hara Desktop 1.1.0 brings a redesigned workspace and personal channels on your Mac:

- The workspace fills the window, without the outer gutter or card frame. Both light and dark themes leave room for the macOS window controls.
- The interface follows your system language by default. Choose English, Simplified Chinese or Traditional Chinese under Appearance & language.
- Create a channel in the current workspace and add multiple AI colleagues. Ask all or selected colleagues to reply, or save a note. No cloud login is required. Channel history stays in the current workspace on this Mac; replies use your configured model connection.
- Switches keep their capsule shape without a rectangular background. Local web previews open beside the chat, keeping your conversation and draft available as you widen, restore or close the panel.

**Upgrading from Desktop 1.0.3:** open Settings → App & updates → Check for updates, then follow the download and restart prompts. After upgrading, this page is called Software updates. Finish ongoing work and keep a recoverable data backup first.

The bundled engine still carries the **1.0.2** version label and includes the local-channel extension needed by this release. Its contents differ from the separately released Core/CLI 1.0.2. Desktop does not require a separate npm or Pi installation; keep its bundled engine.

**Mac downloads:** choose the Apple Silicon or Intel package from the release downloads.

Known scope: Inviting other people is a placeholder in this version; no launch date is promised. Channels currently work with AI colleagues in this workspace. The local browser preview does not provide general web browsing or Chrome pairing.

After upgrading, check your existing workspace's colleagues, history, schedules and model connections. Then try a new channel, both themes and the right-side preview. Intel testers should include their Mac model and whether it is physical Intel hardware. Report issues in the original feedback thread with the Desktop version, Mac/macOS, theme/language, steps and a screenshot.
