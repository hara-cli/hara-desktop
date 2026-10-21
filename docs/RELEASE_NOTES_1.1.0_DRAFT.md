# Hara Desktop 1.1.0 — prepared release notes and candidate status

Prepared 2026-10-21 (Asia/Taipei). **English and Simplified Chinese copy is ready for the candidate handoff. Publication and Jeff's acceptance remain pending; this document does not authorize a release, push or tag.**

Prepared public announcement: [PUBLIC_ANNOUNCEMENT_1.1.0_DRAFT.md](PUBLIC_ANNOUNCEMENT_1.1.0_DRAFT.md). Its English and Chinese invitation scope matches these release notes; publication fields remain pending.

## English

Ready-to-copy text: [RELEASE_NOTES_1.1.0.en.md](RELEASE_NOTES_1.1.0.en.md).

## 简体中文

可直接使用的文案：[RELEASE_NOTES_1.1.0.zh-Hans.md](RELEASE_NOTES_1.1.0.zh-Hans.md)。

## 繁體中文

- 全新工作空間配置，讓 Hara、同事、私聊和任務更容易找到。淺色和深色主題鋪滿視窗，搭配新的牛血紅強調色。
- 在本機建立個人頻道，加入目前工作空間的同事，無需登入雲端，也沒有頻道成員人數配額。每則訊息可讓全部或部分同事回覆，也可只儲存為筆記。聊天記錄保存在目前工作空間。
- 依姓名或角色搜尋頻道成員和回覆對象，搜尋時保留已選同事，並顯示回覆人數。較窄聊天區域的操作更精簡，較矮視窗中仍可方便地儲存變更。
- 本機網頁預覽在聊天右側展開，可放大、還原或關閉面板，聊天和草稿持續保留。
- 介面語言預設跟隨系統，可在設定中切換繁體中文、簡體中文或英語。連續操作合併為一行，可展開查看詳情。
- 修正開關背後的方形底色，淺色、深色以及滑鼠停留、鍵盤聚焦、停用狀態均維持膠囊外形。
- 修正設定總覽的英文連接數量文案：一個有效連接顯示「1 connection」，零個或多個連接使用複數。
- 本版邀請他人為占位，不承諾上線時間。個人頻道可與目前工作空間的本機 同事一起使用。

## Candidate provenance and publication state

| Item | Observed / prepared state |
| --- | --- |
| Previously signed macOS candidate | Desktop `09396d579704601f8929bf41b9ad49ab8ab74e5d`; ARM64/Intel App ZIP + DMG signed, notarized and stapled; retained unchanged |
| Prepared candidate application source | `feat/main-redesign-1.1.0`, including channel polish, capsule switches and connection-count grammar; exact frozen SHA, source bundles and validation in the dated candidate handoff report; **not included in the above signed packages** |
| Bundled Core | Version label 1.0.2, unpublished channel extension `4cde6bd49ad7095bd9820677220d4650ed95bf5c`, based on released Core 1.0.2; released tag does not contain this extension |
| Local automated checks / native pixels | See the dated phase report; Rosetta on an ARM Mac is distinct from a physical Intel Mac |
| Jeff / tester acceptance | Pending; automated and agent visual checks are not human acceptance |
| GitHub release / updater / npm | No 1.1.0 publication or update-channel change in this slice; no public 1.1.0 upgrade command |
| Domestic website / international website | Not updated by this slice; live states not independently rechecked here |
| Apple notarization | Applies to the retained `09396d5` candidate only; the newly frozen application source has not been repackaged or submitted by this slice |
| Mac App Store / iOS / TestFlight | No upload or submission in this slice; no current store-state readback |

The 1.0.4 release was stopped by Jeff; this draft does not replace that tag or hidden draft. The last owner handoff reported stable 1.0.3, not independently rechecked here.

The canonical ASO repository is `tools/aso` under the shared projects directory, with Desktop localization in `hara/aso/{en,hans}.md` and history in `hara/upgrade/<version>-desktop.md`. Its instructions and existing Hara records were read for this draft. When a release is authorized, synchronize the approved update descriptions and exact source/build/channel states there, preserving historical entries and unrelated work; Traditional Chinese copy above is prepared for review, not an existing store-submission claim.

## Candidate lane handoff

The application source is separate from the P0 candidate orchestration/workflow source. `hara:1.1` owns the candidate lane and must bind the newly frozen Desktop/Core SHA pair to the reviewed workflow, controlled ref and runner admission. Admission or packages for `09396d5` do not establish admission or verification for a changed source. No workflow, protected environment or runner configuration is changed by this notes/copy slice.

The full lane must use formal updater-file and Pi-only checks, complete platform packages including a real Intel runner's DMG, signing/notarization and independent artifact/upgrade verification before any release tag. Local unit/browser tests and the older Rosetta candidate remain separate evidence. The unpublished Core extension must retain its exact source identity; do not move or relabel the public Core 1.0.2 tag to satisfy its lock.

## Focused acceptance draft

1. Create a workspace and local channel, add several colleagues, choose all or a subset to reply, then reopen the app and confirm membership and history recover.
2. Search for a member or reply recipient, clear the search and confirm the selection is retained. Verify the count, a single colleague, and notes without a model connection.
3. Check channel controls with the browser open beside chat and member dialogs in a shorter window. Confirm invite remains explanatory only.
4. Check light/dark themes and system/manual language choices. Confirm private chats, other channels and other workspaces keep separate histories and drafts.
5. Check all switch locations in both themes, including hover, keyboard focus, disabled preview and pending skill/schedule saves. Confirm there is no rectangular fill behind the capsule.
6. With English selected, verify Settings overview shows “0 connections”, “1 connection” and “2 connections” for the corresponding active counts; archived connections must not increase the count. Confirm Simplified/Traditional Chinese counts still render correctly.
