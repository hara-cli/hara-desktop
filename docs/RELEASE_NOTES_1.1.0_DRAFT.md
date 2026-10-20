# Hara Desktop 1.1.0 — release notes draft

Prepared 2026-10-21 (Asia/Taipei). **Draft for Jeff's review; no release, push or tag authorized by this document.**

## English

- A new workspace layout puts Hara, colleagues, private chats and tasks within easy reach. Light and dark themes fill the window, with the new oxblood accent.
- Create personal channels on this Mac and add colleagues from the current workspace, without a cloud login or a channel member quota. Choose everyone, selected colleagues or just save a note. Conversation history stays in that workspace.
- Find channel members and reply recipients by name or role. Search keeps your selections, and the reply summary shows how many colleagues will respond. Channel controls fit smaller chat areas, with save actions accessible in shorter windows.
- Open local web previews beside the conversation. Expand, restore or close the right panel while keeping your chat and draft available.
- The interface follows the system language by default, with English, Simplified Chinese and Traditional Chinese available in Settings. Consecutive operations share a compact details row.
- Inviting other people is a placeholder for a future update; this version's channels work with your local colleagues.

## 简体中文

- 全新工作空间布局，让 Hara、同事、私聊和任务更易找到。浅色和深色主题铺满窗口，搭配新的牛血红强调色。
- 在本机创建个人频道，添加当前工作空间的同事，无需登录云端，也没有频道成员人数配额。每条消息可让全部或部分同事回复，也可只保存为笔记。聊天记录保存在当前工作空间。
- 按姓名或角色搜索频道成员和回复对象，搜索时保留已选同事，并显示回复人数。较窄聊天区域的操作更紧凑，较矮窗口中仍可方便地保存更改。
- 本地网页预览在聊天右侧展开，可放大、还原或关闭面板，聊天和草稿持续保留。
- 界面语言默认跟随系统，可在设置中切换简体中文、繁体中文或英语。连续操作合并为一行，可展开查看详情。
- 邀请其他人的入口暂为占位，后续版本接入；本版频道可先与本机同事一起使用。

## 繁體中文

- 全新工作空間配置，讓 Hara、同事、私聊和任務更容易找到。淺色和深色主題鋪滿視窗，搭配新的牛血紅強調色。
- 在本機建立個人頻道，加入目前工作空間的同事，無需登入雲端，也沒有頻道成員人數配額。每則訊息可讓全部或部分同事回覆，也可只儲存為筆記。聊天記錄保存在目前工作空間。
- 依姓名或角色搜尋頻道成員和回覆對象，搜尋時保留已選同事，並顯示回覆人數。較窄聊天區域的操作更精簡，較矮視窗中仍可方便地儲存變更。
- 本機網頁預覽在聊天右側展開，可放大、還原或關閉面板，聊天和草稿持續保留。
- 介面語言預設跟隨系統，可在設定中切換繁體中文、簡體中文或英語。連續操作合併為一行，可展開查看詳情。
- 邀請其他人的入口暫為預留，後續版本接入；本版頻道可先與本機同事一起使用。

## Candidate provenance and publication state

| Item | Observed / prepared state |
| --- | --- |
| Previously signed macOS candidate | Desktop `09396d579704601f8929bf41b9ad49ab8ab74e5d`; ARM64/Intel App ZIP + DMG signed, notarized and stapled; retained unchanged |
| This polish source | Follow-up on `feat/main-redesign-1.1.0`; exact final SHA and validation in the phase report; **not included in the above signed packages** |
| Bundled Core | Version label 1.0.2, unpublished channel extension `4cde6bd49ad7095bd9820677220d4650ed95bf5c`, based on released Core 1.0.2; released tag does not contain this extension |
| Local automated checks / native pixels | See the dated phase report; Rosetta on an ARM Mac is distinct from a physical Intel Mac |
| Jeff / tester acceptance | Pending; automated and agent visual checks are not human acceptance |
| GitHub release / updater / npm | No 1.1.0 publication or update-channel change in this slice; no public 1.1.0 upgrade command |
| Domestic website / international website | Not updated by this slice; live states not independently rechecked here |
| Apple notarization | Applies to the retained `09396d5` candidate only; polish source has not been repackaged or submitted |
| Mac App Store / iOS / TestFlight | No upload or submission in this slice; no current store-state readback |

The 1.0.4 release was stopped by Jeff; this draft does not replace that tag or hidden draft. The last owner handoff reported stable 1.0.3, not independently rechecked here.

The canonical ASO repository is `/Users/zhujianbo/work/projects/tools/aso`, with Desktop localization in `hara/aso/{en,hans}.md` and history in `hara/upgrade/<version>-desktop.md`. Its instructions and existing Hara records were read for this draft. When a release is authorized, synchronize the approved update descriptions and exact source/build/channel states there, preserving historical entries and unrelated work; Traditional Chinese copy above is prepared for review, not an existing store-submission claim.

## Focused acceptance draft

1. Create a workspace and local channel, add several colleagues, choose all or a subset to reply, then reopen the app and confirm membership and history recover.
2. Search for a member or reply recipient, clear the search and confirm the selection is retained. Verify the count, a single colleague, and notes without a model connection.
3. Check channel controls with the browser open beside chat and member dialogs in a shorter window. Confirm invite remains explanatory only.
4. Check light/dark themes and system/manual language choices. Confirm private chats, other channels and other workspaces keep separate histories and drafts.
