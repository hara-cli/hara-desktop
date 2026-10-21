import { WORKSPACE_SETTINGS_KEYS } from "./workspace-settings-i18n.ts";

// Shared shell keys in English, Simplified Chinese and Traditional Chinese.
export const WORKSPACE_KEYS = [
  [
    "ws.space.current",
    "Current workspace",
    "当前空间",
    "目前空間"
  ],
  [
    "ws.space.switch",
    "Switch workspace",
    "切换工作空间",
    "切換工作空間"
  ],
  [
    "ws.space.new",
    "New workspace",
    "新建工作空间",
    "建立工作空間"
  ],
  [
    "ws.search",
    "Search",
    "搜索",
    "搜尋"
  ],
  [
    "ws.main.tag",
    "Main",
    "主 Hara",
    "主 Hara"
  ],
  [
    "ws.main.subtitle",
    "Your coordinator and where chats start",
    "你的总调度，也是聊天的起点",
    "你的總調度，也是聊天的起點"
  ],
  [
    "ws.nav.colleagues",
    "Colleagues",
    "同事",
    "同事"
  ],
  [
    "ws.nav.aria",
    "Workspace navigation",
    "工作空间导航",
    "工作空間導覽"
  ],
  [
    "ws.section.dm",
    "Messages",
    "私信",
    "私訊"
  ],
  [
    "ws.dm.all",
    "All {n}",
    "全部 {n} 位",
    "全部 {n} 位"
  ],
  [
    "ws.dm.empty",
    "Ask Hara who you need; it will suggest the right colleague.",
    "跟 Hara 聊聊你需要谁，它会提议合适的同事。",
    "跟 Hara 聊聊你需要誰，它會提議合適的同事。"
  ],
  [
    "ws.colleagues.discuss",
    "Discuss a new colleague with Hara",
    "与 Hara 讨论新同事",
    "與 Hara 討論新同事"
  ],
  [
    "ws.quota.count",
    "{n} / {max} colleagues",
    "{n} / {max} 位同事",
    "{n} / {max} 位同事"
  ],
  [
    "ws.quota.note",
    "Main Hara and archived colleagues don’t count",
    "主 Hara 与已归档同事不计入",
    "主 Hara 與已歸檔同事不計入"
  ],
  [
    "ws.me",
    "You",
    "你",
    "你"
  ],
  [
    "ws.settings",
    "Settings",
    "设置",
    "設定"
  ],
  [
    "ws.settings.update",
    "Settings (update available)",
    "设置（有新版本）",
    "設定（有新版本）"
  ],
  [
    "ws.unread",
    "{n} unread",
    "{n} 条未读",
    "{n} 則未讀"
  ],
  [
    "ws.await.title",
    "Waiting for you",
    "等你处理",
    "等你處理"
  ],
  [
    "ws.await.all",
    "View all in Tasks",
    "在任务与工单查看全部",
    "在任務與工單查看全部"
  ],
  [
    "ws.await.approve",
    "Approve",
    "批准",
    "批准"
  ],
  [
    "ws.await.open",
    "Open",
    "查看",
    "查看"
  ],
  [
    "ws.await.kind.approval",
    "Approval",
    "待审批",
    "待審批"
  ],
  [
    "ws.await.kind.review",
    "Review",
    "待验收",
    "待驗收"
  ],
  [
    "ws.await.kind.reply",
    "Reply",
    "等你回复",
    "等你回覆"
  ],
  [
    "ws.home.title",
    "What shall we get done today?",
    "今天，想一起完成什么？",
    "今天，想一起完成什麼？"
  ],
  [
    "ws.home.hint",
    "Say hi, or ask me to “create a colleague Coder”.",
    "先打个招呼，或请我「建立同事 Coder」。",
    "先打個招呼，或請我「建立同事 Coder」。"
  ],
  [
    "ws.home.chip.colleague",
    "Create a colleague",
    "建立一位同事",
    "建立一位同事"
  ],
  [
    "ws.home.chip.tasks",
    "What is everyone working on?",
    "大家在做什么？",
    "大家在做什麼？"
  ],
  [
    "ws.header.browser",
    "Browser",
    "浏览器扩展",
    "瀏覽器擴充"
  ],
  [
    "ws.header.runtime",
    "{role} · Pi built-in runtime",
    "{role} · Pi 内置运行时",
    "{role} · Pi 內建執行環境"
  ],
  [
    "ws.role.colleague",
    "Colleague",
    "同事",
    "同事"
  ],
  [
    "ws.composer.placeholder",
    "Message {name}…",
    "发消息给 {name}…",
    "傳訊息給 {name}…"
  ],
  [
    "ws.composer.noConnection",
    "Connect a model for this workspace first",
    "请先为这个空间接上模型",
    "請先為這個空間接上模型"
  ],
  [
    "ws.composer.connection",
    "Pi · this workspace’s default connection",
    "Pi · 本空间默认连接",
    "Pi · 本空間預設連接"
  ],
  [
    "ws.composer.attach",
    "Add files",
    "添加文件",
    "加入檔案"
  ],
  [
    "ws.composer.send",
    "Send message",
    "发送消息",
    "傳送訊息"
  ],
  [
    "ws.composer.stop",
    "Stop",
    "停止",
    "停止"
  ],
  [
    "ws.composer.hint.keys",
    "Enter to send · Shift + Enter for a new line",
    "Enter 发送，Shift + Enter 换行",
    "Enter 傳送，Shift + Enter 換行"
  ],
  [
    "ws.composer.hint.local",
    "Tasks and history stay on this Mac",
    "任务与历史保存在本机",
    "任務與歷史儲存在本機"
  ],
  [
    "ws.colleagues.tab.people",
    "Colleagues",
    "同事",
    "同事"
  ],
  [
    "ws.colleagues.tab.tasks",
    "Tasks & tickets",
    "任务与工单",
    "任務與工單"
  ],
  [
    "ws.tasks.group.needsYou",
    "Needs you",
    "需要你",
    "需要你"
  ],
  [
    "ws.tasks.group.working",
    "In progress",
    "进行中",
    "進行中"
  ],
  [
    "ws.tasks.group.waiting",
    "Waiting",
    "等待中",
    "等待中"
  ],
  [
    "ws.tasks.group.closed",
    "Closed",
    "已结束",
    "已結束"
  ],
  [
    "ws.tasks.intro",
    "This workspace’s work record. Schedules live in Settings.",
    "这里是这个空间的工作记录。定时计划在设置中管理。",
    "這裡是這個空間的工作記錄。定時計畫在設定中管理。"
  ],
  [
    "ws.tasks.empty",
    "No tasks yet. Tell Hara or a colleague what you want done.",
    "还没有任务。向 Hara 或一位同事说说你想完成什么。",
    "還沒有任務。向 Hara 或一位同事說說你想完成什麼。"
  ],
  [
    "ws.sec.colleagues",
    "Colleagues",
    "同事",
    "同事"
  ],
  [
    "ws.sec.channels",
    "Channels",
    "频道",
    "頻道"
  ],
  [
    "ws.sec.dms",
    "Messages",
    "私信",
    "私訊"
  ],
  [
    "ws.sec.toggle",
    "{name}, {state}",
    "{name}，{state}",
    "{name}，{state}"
  ],
  [
    "ws.sec.expanded",
    "expanded",
    "已展开",
    "已展開"
  ],
  [
    "ws.sec.collapsed",
    "collapsed",
    "已收起",
    "已收合"
  ],
  [
    "ws.sec.openColleagues",
    "Open Colleagues",
    "打开同事页",
    "開啟同事頁"
  ],
  [
    "ws.sec.newDm",
    "New message",
    "新私信",
    "新私訊"
  ],
  [
    "ws.sec.unread",
    "{n} unread",
    "{n} 条未读",
    "{n} 則未讀"
  ],
  [
    "ws.sec.pending",
    "{n} waiting for you",
    "{n} 项等你处理",
    "{n} 項等你處理"
  ],
  [
    "ws.colleagues.working",
    "Working",
    "工作中",
    "工作中"
  ],
  [
    "ws.colleagues.needsYou",
    "Needs you",
    "等你",
    "等你"
  ],
  [
    "ws.colleagues.idle",
    "Idle",
    "空闲",
    "閒置"
  ],
  [
    "ws.channels.empty.title",
    "No channels yet",
    "还没有频道",
    "還沒有頻道"
  ],
  [
    "ws.channels.empty.body",
    "Create a local channel and bring your colleagues together.",
    "新建本机频道，和多位同事一起聊。",
    "建立本機頻道，和多位同事一起聊。"
  ],
  [
    "common.loading",
    "Loading…",
    "正在读取…",
    "正在讀取…"
  ]
] as const;

// Additional live controls and recovery copy; the canonical keys above remain unchanged.
export const WORKSPACE_EXTRA_KEYS = [
  ["ws.channels.new", "New channel", "新建频道", "建立頻道"],
  ["ws.channels.name", "Channel name", "频道名称", "頻道名稱"],
  ["ws.channels.namePlaceholder", "e.g. Product planning", "例如：产品讨论", "例如：產品討論"],
  ["ws.channels.createBody", "Start a conversation with colleagues in this workspace. No cloud login needed.", "和本空间的同事一起讨论，无需登录云端。", "和本空間的同事一起討論，無需登入雲端。"],
  ["ws.channels.local", "Local channel", "本机频道", "本機頻道"],
  ["ws.channels.members", "Channel members", "频道成员", "頻道成員"],
  ["ws.channels.memberCount", "You + {n} colleagues", "你和 {n} 位同事", "你和 {n} 位同事"],
  ["ws.channels.memberOne", "You + 1 colleague", "你和 1 位同事", "你和 1 位同事"],
  ["ws.channels.selectMembers", "Choose colleagues", "选择同事", "選擇同事"],
  ["ws.channels.searchMembers", "Find a colleague", "搜索同事", "搜尋同事"],
  ["ws.channels.all", "Select all", "全选", "全選"],
  ["ws.channels.none", "Clear selection", "取消全选", "取消全選"],
  ["ws.channels.noColleagues", "No colleagues in this workspace yet. You can create the channel now and add them later.", "本空间还没有同事。可以先建频道，之后再添加。", "本空間還沒有同事。可以先建頻道，之後再加入。"],
  ["ws.channels.noRecipients", "This channel has no colleagues yet. Add them in Channel members, or save a note.", "这个频道还没有同事。可以在“频道成员”中添加，也可以先保存笔记。", "這個頻道還沒有同事。可以在「頻道成員」中加入，也可以先儲存筆記。"],
  ["ws.channels.localNote", "Stored on this device in the current workspace.", "记录保存在本机当前工作空间。", "記錄保存在本機目前工作空間。"],
  ["ws.channels.history.label", "Channel history", "频道记录", "頻道記錄"],
  ["ws.channels.history.older", "Earlier records", "较早记录", "較早記錄"],
  ["ws.channels.history.newer", "Newer records", "较新记录", "較新記錄"],
  ["ws.channels.history.latest", "Back to latest", "回到最新", "回到最新"],
  ["ws.channels.history.range", "Records {from}–{to} of {total}", "第 {from}–{to} 条，共 {total} 条记录", "第 {from}–{to} 筆，共 {total} 筆記錄"],
  ["ws.channels.save", "Save changes", "保存更改", "儲存變更"],
  ["ws.channels.invite", "Invite other people", "邀请其他人", "邀請其他人"],
  ["ws.channels.inviteTitle", "Invite people later", "稍后邀请其他人", "稍後邀請其他人"],
  ["ws.channels.inviteBody", "Inviting other people will be available later. For now, chat with your local colleagues here.", "邀请其他人加入的功能后续开放。现在可以先和本机同事在这里聊。", "邀請其他人加入的功能後續開放。現在可以先和本機同事在這裡聊。"],
  ["ws.channels.emptyConversation", "Start the conversation", "聊点什么吧", "聊點什麼吧"],
  ["ws.channels.emptyHint", "Send a message and choose which colleagues should reply. They respond once, in order.", "发送消息时可选择回复的同事，他们会依次回复。", "傳送訊息時可選擇回覆的同事，他們會依序回覆。"],
  ["ws.channels.placeholder", "Message #{name}", "发消息到 #{name}", "傳送訊息到 #{name}"],
  ["ws.channels.responders", "Choose who replies", "选择回复的同事", "選擇回覆的同事"],
  ["ws.channels.replyAll", "All {n} colleagues reply", "全部 {n} 位同事回复", "全部 {n} 位同事回覆"],
  ["ws.channels.replyCount", "{n} colleagues reply", "{n} 位同事回复", "{n} 位同事回覆"],
  ["ws.channels.replyOne", "1 colleague replies", "1 位同事回复", "1 位同事回覆"],
  ["ws.channels.notesOnly", "Just save my message", "仅保存我的消息", "僅儲存我的訊息"],
  ["ws.channels.replying", "Colleagues are replying…", "同事正在回复…", "同事正在回覆…"],
  ["ws.channels.failedReply", "{name} did not finish replying. No request was resent.", "{name} 未完成回复，没有自动重发。", "{name} 未完成回覆，沒有自動重送。"],
  ["ws.channels.cancelled", "Replies stopped. Queued colleagues will not be called.", "已停止回复，不会继续调用排队中的同事。", "已停止回覆，不會繼續呼叫排隊中的同事。"],
  ["ws.channels.interrupted", "The previous conversation was interrupted. Saved replies are kept; nothing was resent.", "上次讨论已中断。已保存的回复仍在，没有重发请求。", "上次討論已中斷。已儲存的回覆仍在，沒有重送請求。"],
  ["ws.channels.engineRequired", "This engine does not support local channels. Update the engine to use them.", "当前引擎不支持本机频道，请更新引擎后使用。", "目前引擎不支援本機頻道，請更新引擎後使用。"],
  ["ws.channels.loadFailed", "Couldn't read local channels. Try again.", "未能读取本机频道，请重试。", "未能讀取本機頻道，請重試。"],
  ["ws.channels.saveFailed", "Couldn't save the channel. Refresh and check your changes.", "未能保存频道，请刷新后核对更改。", "未能儲存頻道，請重新整理後核對變更。"],
  ["ws.channels.createUnknown", "Channel creation is still being checked. Verify before creating another.", "正在核对频道是否已创建，请先查看结果。", "正在核對頻道是否已建立，請先查看結果。"],
  ["ws.channels.sendFailed", "The message was not accepted. Your draft is kept.", "消息未被接受，草稿已保留。", "訊息未被接受，草稿已保留。"],
  ["ws.channels.sendUnknown", "Message acceptance is unknown. Verify the original request; do not resend it.", "消息是否已接受仍待核对，请查看原请求结果。", "訊息是否已接受仍待核對，請查看原請求結果。"],
  ["ws.channels.cancelFailed", "Stop is unconfirmed. Refresh to check the current conversation.", "停止结果尚未确认，请刷新核对当前讨论。", "停止結果尚未確認，請重新整理核對目前討論。"],
  ["ws.channels.approvalFailed", "Approval result is unconfirmed. Refresh to check the original card.", "审批结果尚未确认，请刷新核对原审批卡。", "審批結果尚未確認，請重新整理核對原審批卡。"],
  ["ws.channels.unavailable", "This local channel is unavailable in the current workspace.", "当前空间中没有这个本机频道。", "目前空間中沒有這個本機頻道。"],
  ...WORKSPACE_SETTINGS_KEYS,
  ['ws.locale.en', 'English', 'English', 'English'],
  ['ws.locale.system', 'Follow system', '跟随系统', '跟隨系統'],
  ['ws.locale.hans', '简体中文', '简体中文', '简体中文'],
  ['ws.locale.hant', '繁體中文', '繁體中文', '繁體中文'],
  ['ws.theme.title', 'Theme', '主题', '主題'],
  ['ws.theme.system', 'System', '跟随系统', '跟隨系統'],
  ['ws.theme.light', 'Light', '浅色', '淺色'],
  ['ws.theme.dark', 'Dark', '深色', '深色'],
  ['ws.theme.note', 'Appearance stays on this Mac across app versions.', '外观偏好保存在这台 Mac，不随应用版本改变。', '外觀偏好儲存在這台 Mac，不隨應用程式版本改變。'],
  ['ws.theme.unavailable', 'Appearance preferences are not available yet.', '外观偏好暂时不可用。', '外觀偏好暫時無法使用。'],
  ['ws.space.default', 'My workspace', '我的工作空间', '我的工作空間'],
  ['ws.quota.current', '{n} colleagues', '{n} 位同事', '{n} 位同事'],
  ['ws.header.otherRuntime', '{role} · {runtime}', '{role} · {runtime}', '{role} · {runtime}'],
  ['ws.space.choose', 'Choose a workspace', '选择工作空间', '選擇工作空間'],
  ['ws.space.note', 'Each workspace has its own Hara, colleagues, connections and memory.', '每个空间都有自己的 Hara、同事、连接与记忆。', '每個空間都有自己的 Hara、同事、連接與記憶。'],
  ['ws.search.placeholder', 'Find a colleague…', '搜索同事…', '搜尋同事…'],
  ['ws.search.empty', 'No matching colleagues', '没有匹配的同事', '沒有符合的同事'],
  ['ws.close', 'Close', '关闭', '關閉'],
  ['ws.cancel', 'Cancel', '取消', '取消'],
  ['ws.back', 'Back to chat', '返回聊天', '返回聊天'],
  ['ws.reconnect', 'Reconnect', '重新连接', '重新連接'],
  ['ws.disconnected', 'Core disconnected. History and files are retained; tasks will not restart automatically.', '本机引擎连接中断。历史与文件仍保留，任务不会自动重跑。', '本機引擎連線中斷。歷史與檔案仍保留，任務不會自動重跑。'],
  ['ws.welcome.title', 'A workspace starts with you and Hara.', '一个空间，从你和 Hara 开始。', '一個空間，從你和 Hara 開始。'],
  ['ws.welcome.body', 'Chat, meet colleagues and get things done together.', '聊天、找同事，一起完成事情。', '聊天、找同事，一起完成事情。'],
  ['ws.welcome.create', 'Create a personal workspace', '建立个人工作空间', '建立個人工作空間'],
  ['ws.welcome.note', 'Connections and work records belong to each workspace. Existing data is retained.', '连接与工作记录属于各自的工作空间，原有资料保留。', '連接與工作記錄屬於各自的工作空間，原有資料保留。'],
  ['ws.lab.note', 'Isolated local acceptance workspace', '隔离的本机验收空间', '隔離的本機驗收空間'],
  ['ws.lab.synthetic', 'Synthetic mode · no external model calls', '合成模式 · 不调用外部模型', '合成模式 · 不呼叫外部模型'],
  ['ws.lab.real', 'Authorized model · isolated acceptance', '已授权模型 · 隔离验收', '已授權模型 · 隔離驗收'],
  ['ws.connection.title', 'Connect a model to chat with Hara.', '跟 Hara 聊天，先接上模型。', '跟 Hara 聊天，先接上模型。'],
  ['ws.connection.body', 'Add a connection for this workspace in Settings.', '在设置中为这个工作空间添加模型连接。', '在設定中為這個工作空間加入模型連接。'],
  ['ws.connection.configure', 'Configure this workspace’s connection', '配置本空间连接', '設定本空間連接'],
  ['ws.connection.synthetic', 'Enable the local synthetic connection', '启用本机合成连接', '啟用本機合成連接'],
  ['ws.connection.approved', 'Use the authorized connection', '使用已授权连接', '使用已授權連接'],
  ['ws.colleagues.prompt', 'I would like a new colleague. Please discuss responsibilities and boundaries, then show a confirmation card before creating one.', '我想建立一位同事，请先和我讨论职责与边界，再用确认卡片创建。', '我想建立一位同事，請先和我討論職責與邊界，再用確認卡片建立。'],
  ['ws.colleagues.open', 'Open conversation', '打开对话', '開啟對話'],
  ['ws.colleagues.title', 'People you work with', '一起工作的人', '一起工作的人'],
  ['ws.tasks.openConversation', 'Open in conversation', '在对话里打开', '在對話裡開啟'],
  ['ws.tasks.currentOnly', 'Showing current tasks. Earlier work remains in the original conversations.', '仅显示当前任务，过往工作仍保留在原对话中。', '僅顯示目前任務，過往工作仍保留在原對話中。'],
  ['ws.tasks.unavailable', 'Some conversations could not be read. Counts may be incomplete. Try again.', '部分对话暂时无法读取，数字可能不完整，请重试。', '部分對話暫時無法讀取，數字可能不完整，請重試。'],
  ['ws.tasks.retry', 'Refresh work records', '刷新工作记录', '重新整理工作記錄'],
  ['ws.tasks.untitled', 'Current task', '当前任务', '目前任務'],
  ['ws.tasks.status.pending', 'Pending approval', '待审批', '待審批'],
  ['ws.tasks.status.reply', 'Waiting for your reply', '等你回复', '等你回覆'],
  ['ws.tasks.status.review', 'Awaiting review', '待验收', '待驗收'],
  ['ws.tasks.status.blocked', 'Blocked', '受阻', '受阻'],
  ['ws.tasks.status.accepted', 'Accepted', '已接单', '已接單'],
  ['ws.tasks.status.running', 'In progress', '进行中', '進行中'],
  ['ws.tasks.status.dispatched', 'Dispatched', '已派出', '已派出'],
  ['ws.tasks.status.queued', 'Not dispatched', '待派', '待派'],
  ['ws.tasks.status.completed', 'Completed', '已完成', '已完成'],
  ['ws.tasks.status.cancelled', 'Withdrawn', '已撤回', '已撤回'],
  ['ws.tasks.status.rejected', 'Rejected', '已拒绝', '已拒絕'],
  ['ws.tasks.status.expired', 'Expired', '已过期', '已過期'],
  ['ws.tasks.status.paused', 'Paused', '已暂停', '已暫停'],
  ['ws.tasks.status.unknown', 'Status unavailable', '状态待核对', '狀態待核對'],
  ['ws.approval.label', 'Confirm a new colleague', '确认建立同事', '確認建立同事'],
  ['ws.approval.kicker', 'Hara would like your confirmation', 'Hara 想请你确认', 'Hara 想請你確認'],
  ['ws.approval.title', 'Invite {name} to this workspace?', '让 {name} 加入这个空间？', '讓 {name} 加入這個空間？'],
  ['ws.approval.summary', 'Invite {name}', '邀请 {name} 加入', '邀請 {name} 加入'],
  ['ws.approval.runtime', 'Pi · built in', 'Pi · 内置', 'Pi · 內建'],
  ['ws.approval.details', 'Responsibilities and boundaries', '职责与边界', '職責與邊界'],
  ['ws.approval.boundary', 'Only for this workspace. This card grants no additional tools or computer permissions.', '只在当前工作空间工作；这张卡不授予额外工具或电脑权限。', '只在目前工作空間工作；這張卡不授予額外工具或電腦權限。'],
  ['ws.approval.decline', 'Not now', '暂不建立', '暫不建立'],
  ['ws.approval.confirm', 'Confirm new colleague', '确认建立同事', '確認建立同事'],
  ['ws.approval.urgent', 'Priority approval', '优先审批', '優先審批'],
  ['ws.approval.stale', 'This approval is no longer pending. Check the conversation for its latest status.', '这项审批已不再待处理，请在对话中核对最新状态。', '這項審批已不再待處理，請在對話中核對最新狀態。'],
  ['ws.execution.count', '{n} operations', '{n} 个操作', '{n} 個操作'],
  ['ws.execution.one', '1 operation', '1 个操作', '1 個操作'],
  ['ws.execution.details', 'View details', '查看详情', '查看詳情'],
  ['ws.execution.task_intake', 'Confirm task', '确认任务', '確認任務'],
  ['ws.execution.task_checkpoint', 'Save verification receipt', '保存验证回执', '儲存驗證回執'],
  ['ws.execution.todo_write', 'Update steps', '更新步骤', '更新步驟'],
  ['ws.execution.workspace_read', 'Read files', '查看文件', '查看檔案'],
  ['ws.execution.workspace_write', 'Write files', '写入文件', '寫入檔案'],
  ['ws.execution.workspace_verify', 'Verify content', '核验内容', '核驗內容'],
  ['ws.execution.agent_list', 'View colleagues', '查看同事', '查看同事'],
  ['ws.execution.agent_create', 'Propose a colleague', '提议同事', '提議同事'],
  ['ws.execution.agent_contact', 'Delegate to a colleague', '委派同事', '委派同事'],
  ['ws.verified', 'Result verified', '已核验结果', '已核驗結果'],
  ['ws.verified.note', 'Task closed · details available on request', '任务已闭环，详情按需展开', '任務已閉環，詳情按需展開'],
  ['ws.resume.cancelled', 'This run was cancelled', '本次执行已取消', '本次執行已取消'],
  ['ws.resume.title', 'The previous task is unfinished', '上次任务尚未完成', '上次任務尚未完成'],
  ['ws.resume.body', 'History and files are retained. Check the result before explicitly continuing. Restarting does not rerun the task.', '历史与文件已保留。请先检查结果，再明确继续原任务；重启不会自动重跑。', '歷史與檔案已保留。請先檢查結果，再明確繼續原任務；重新啟動不會自動重跑。'],
  ['ws.resume.budget', 'The original run budget is unavailable. Check the result and budget first.', '原任务的续跑预算不可用，请先检查结果与预算。', '原任務的續跑預算不可用，請先檢查結果與預算。'],
  ['ws.resume.action', 'Continue the original task', '继续原任务', '繼續原任務'],
  ['ws.replying', '{name} is replying', '{name} 正在回复', '{name} 正在回覆'],
  ['ws.draining', 'Stopping · waiting for the original action to finish safely', '正在停止，等待原操作安全结束', '正在停止，等待原操作安全結束'],
  ['ws.composer.verify', 'Check the previous request', '核对上次送出结果', '核對上次送出結果'],
  ['ws.create.title', 'Give your new workspace a name.', '给新空间一个名字。', '給新空間一個名字。'],
  ['ws.create.body', 'Your main Hara will be ready. Arrange connections and colleagues later.', '会为你准备独立的主 Hara，连接与同事稍后安排。', '會為你準備獨立的主 Hara，連接與同事稍後安排。'],
  ['ws.create.name', 'Workspace name', '空间名称', '空間名稱'],
  ['ws.settings.description', 'Connections belong to this workspace. Running tasks keep their original connection.', '这里的连接只属于当前空间，运行中的任务固定原连接。', '這裡的連接只屬於目前空間，執行中的任務固定原連接。'],
  ['ws.settings.appearance', 'Appearance & language', '外观与语言', '外觀與語言'],
  ['ws.settings.language', 'Language', '语言', '語言'],
  ['ws.settings.localData', 'Local work data', '本机工作资料', '本機工作資料'],
  ['ws.settings.usage', '{n} past tasks · {calls} model steps. This is not a provider bill.', '{n} 项历史任务 · {calls} 次模型步骤。不是供应商账单。', '{n} 項歷史任務 · {calls} 次模型步驟。不是供應商帳單。'],
  ['ws.settings.schedules', 'Schedules', '定时任务', '定時任務'],
  ['ws.settings.skills', 'Skills', '技能', '技能'],
  ['ws.settings.runtime', 'Runtime', '执行环境', '執行環境'],
  ['ws.settings.runtimeLab', 'Pi is built in. This isolated lab does not download other runtimes.', 'Pi 已内置，隔离 Lab 不下载额外执行环境。', 'Pi 已內建，隔離 Lab 不下載額外執行環境。'],
  ['ws.boot.connecting', 'Connecting to your workspace…', '正在连接你的工作空间…', '正在連接你的工作空間…'],
  ['ws.boot.opening', 'Opening your workspace…', '正在打开你的工作空间…', '正在開啟你的工作空間…'],
  ['ws.boot.entryFailed', 'Could not verify the workspace entry. Existing data is retained.', '无法确认工作空间入口，原有资料已保留。', '無法確認工作空間入口，原有資料已保留。'],
  ['ws.boot.failed', 'Could not connect to the local workspace engine. Your data is retained; reconnect to try again.', '尚未连接到本机工作空间引擎，原资料已保留，可重试连接。', '尚未連接到本機工作空間引擎，原資料已保留，可重試連接。'],
  ['ws.boot.labFailed', 'Start the dedicated isolated workspace acceptance command to connect.', '请先启动专用的隔离工作空间验收命令。', '請先啟動專用的隔離工作空間驗收命令。'],
  ['ws.boot.retained', 'Existing data is retained. Requests are never resent automatically.', '原有资料保留，请求不会自动重发。', '原有資料保留，請求不會自動重送。'],
  ['ws.browser.title', 'Browser preview', '浏览器预览', '瀏覽器預覽'],
  ['ws.browser.address', 'Preview address', '预览地址', '預覽網址'],
  ['ws.browser.open', 'Open', '打开', '開啟'],
  ['ws.browser.reload', 'Reload preview', '重新载入预览', '重新載入預覽'],
  ['ws.browser.expand', 'Widen right panel', '加宽右侧面板', '加寬右側面板'],
  ['ws.browser.restore', 'Restore panel width', '还原面板宽度', '還原面板寬度'],
  ['ws.browser.close', 'Close browser preview', '关闭浏览器预览', '關閉瀏覽器預覽'],
  ['ws.browser.empty', 'Keep chatting beside your preview', '一边聊天，一边看预览', '一邊聊天，一邊看預覽'],
  ['ws.browser.boundary', 'Open a local preview here. This panel has no access to your chat, credentials or tasks. General web browsing and Chrome pairing are not available in this version.', '在这里打开本机预览。面板不能读取聊天、连接凭据或任务。本版尚未开放普通网页或 Chrome 配对。', '在這裡開啟本機預覽。面板不能讀取聊天、連接憑據或任務。本版尚未開放一般網頁或 Chrome 配對。'],
  ['ws.browser.invalid', 'Enter a local HTTP or HTTPS address without credentials.', '请输入不含登录凭据的本机 HTTP 或 HTTPS 地址。', '請輸入不含登入憑據的本機 HTTP 或 HTTPS 網址。'],
  ["ws.settings.page.overview", "Overview", "概览", "概覽"],
  ["ws.settings.page.connections", "Connections", "连接", "連接"],
  ["ws.settings.page.runtimes", "Runtimes", "运行时", "執行環境"],
  ["ws.settings.page.schedules", "Schedules", "定时任务", "定時任務"],
  ["ws.settings.page.skills", "Skills", "技能", "技能"],
  ["ws.settings.page.members", "Members", "成员", "成員"],
  ["ws.settings.page.general", "Workspace", "空间通用", "空間通用"],
  ["ws.settings.page.appearance", "Appearance & language", "外观与语言", "外觀與語言"],
  ["ws.settings.page.updates", "Software updates", "软件更新", "軟體更新"],
  ["ws.settings.detail.overview", "Each workspace is independent. Appearance and updates belong to this Mac.", "每个工作空间独立；外观与软件更新由这台 Mac 的所有空间共用。", "每個工作空間獨立；外觀與軟體更新由這台 Mac 的所有空間共用。"],
  ["ws.settings.detail.connections", "Connections for Hara and colleagues in this workspace. Running tasks keep their original connection.", "这个空间的 Hara 和同事使用这些连接；运行中的任务保留原连接。", "這個空間的 Hara 和同事使用這些連接；執行中的任務保留原連接。"],
  ["ws.settings.detail.runtimes", "Review local runtimes and approve installations when needed.", "查看本机执行环境，按需批准安装。", "查看本機執行環境，按需批准安裝。"],
  ["ws.settings.detail.schedules", "Schedule work for Hara or a colleague. Results stay in this workspace.", "按时间交给 Hara 或同事执行；结果留在本空间对话。", "按時間交給 Hara 或同事執行；結果留在本空間對話。"],
  ["ws.settings.detail.skills", "Reviewed skill versions stay pinned to this workspace.", "启用的已审阅技能版本固定在本空间。", "啟用的已審閱技能版本固定在本空間。"],
  ["ws.settings.detail.members", "Members and roles in this team workspace.", "团队空间中的成员与角色。", "團隊空間中的成員與角色。"],
  ["ws.settings.detail.general", "Workspace identity, roles and local work data.", "空间身份、角色与本机工作资料。", "空間身分、角色與本機工作資料。"],
  ["ws.settings.detail.appearance", "Display preferences for this Mac, shared across workspaces.", "这台 Mac 的显示偏好，对所有空间立即生效。", "這台 Mac 的顯示偏好，對所有空間立即生效。"],
  ["ws.settings.detail.updates", "Check updates, versions and download progress.", "检查 Hara 更新、版本和下载进度。", "檢查 Hara 更新、版本和下載進度。"],
  ["ws.settings.back", "Back to Hara", "返回 Hara", "返回 Hara"],
  ["ws.settings.navigation", "Settings navigation", "设置导航", "設定導覽"],
  ["ws.settings.opening", "Opening settings…", "正在打开设置…", "正在開啟設定…"],
  ["ws.settings.workspace", "Workspace", "工作空间", "工作空間"],
  ["ws.settings.currentOnly", "This workspace only", "仅本空间", "僅本空間"],
  ["ws.settings.device", "This Mac", "这台 Mac", "這台 Mac"],
  ["ws.settings.allSpaces", "All workspaces", "所有空间", "所有空間"],
  ["ws.settings.noSpace", "No workspace yet", "尚未建立空间", "尚未建立空間"],
  ["ws.settings.team", "Team", "团队", "團隊"],
  ["ws.settings.personal", "Personal", "个人", "個人"],
  ["ws.settings.owner", "You are the owner", "你是所有者", "你是擁有者"],
  ["ws.settings.admin", "You are an admin", "你是管理员", "你是管理員"],
  ["ws.settings.member", "You are a member", "你是成员", "你是成員"],
  ["ws.settings.scope", "Choose a settings workspace", "选择设置的工作空间", "選擇設定的工作空間"],
  ["ws.settings.scopeNote", "Changing this leaves the main chat in its original workspace.", "切换后主聊天的空间保持不变。", "切換後主聊天的空間保持不變。"],
  ["ws.settings.savedHere", "Settings stay on this Mac. Workspace data stays in its own workspace.", "设置保存在这台 Mac；空间资料各自独立。", "設定保存在這台 Mac；空間資料各自獨立。"],
  ["ws.settings.connectionCount", "{n} connections", "{n} 个连接", "{n} 個連接"],
  ["ws.settings.connectionOne", "{n} connection", "{n} 个连接", "{n} 個連接"],
  ["ws.settings.runtimeSummary", "Pi is built in. Add other runtimes when needed.", "Pi 已内置，其他运行时按需安装。", "Pi 已內建，其他執行環境按需安裝。"],
  ["ws.settings.manage", "Manage", "管理", "管理"],
  ["ws.settings.themeSummary", "System / Light / Dark", "跟随系统 / 浅色 / 深色", "跟隨系統 / 淺色 / 深色"],
  ["ws.settings.updateAvailable", "Hara {version} available", "Hara {version} 可用", "Hara {version} 可用"],
  ["ws.settings.updateSummary", "Updates and version information", "更新与版本信息", "更新與版本資訊"],
  ["ws.settings.open", "Open", "打开", "開啟"],
  ["ws.settings.loading", "Loading this workspace…", "正在读取这个空间…", "正在讀取這個空間…"],
  ["ws.settings.createFirst", "Create a workspace in Hara first.", "请先在 Hara 建立工作空间。", "請先在 Hara 建立工作空間。"],
  ["ws.display.mode", "Execution details", "执行信息显示方式", "執行資訊顯示方式"],
  ["ws.display.brief", "Brief", "简洁", "簡潔"],
  ["ws.display.detailed", "Detailed", "详细", "詳細"],
  ["ws.display.collapse", "Collapse execution details by default", "默认折叠执行详情", "預設收合執行詳情"],
  ["ws.tasks.history", "Current tasks and up to 256 recent records from this workspace.", "当前任务与本空间最近最多 256 条工作记录。", "目前任務與本空間最近最多 256 筆工作記錄。"],
  ["ws.tasks.record", "History record", "历史记录", "歷史記錄"],
  ["ws.updates.candidate", "Local candidate", "本机候选版", "本機候選版"],
  ["ws.updates.candidateNote", "This candidate uses its own data directory. It does not check or install public updates.", "本候选使用独立数据目录，不检查或安装公共更新。", "本候選使用獨立資料目錄，不檢查或安裝公開更新。"],
  ["ws.updates.engine", "Engine", "引擎", "引擎"],
  ["ws.updates.channel", "Channel", "渠道", "通道"],
  ["ws.updates.arch", "Architecture", "架构", "架構"],
  ["ws.updates.copy", "Copy version information", "复制版本信息", "複製版本資訊"],
  ["ws.updates.copied", "Copied", "已复制", "已複製"],
  ["ws.notice.settingsNotReady", "The separate settings connection is not ready yet.", "独立设置连接尚未就绪。", "獨立設定連接尚未就緒。"],
  ["ws.notice.invalidView", "The workspace response does not match the original view and was not displayed.", "工作空间响应与原视图不符，已拒绝显示。", "工作空間回應與原檢視不符，已拒絕顯示。"],
  ["ws.notice.inheritancePending", "Legacy data inheritance is incomplete. Original data is retained, and legacy schedules still use the original scheduler. Check migration status before importing again.", "旧资料继承尚未完成，原资料仍保留；旧定时任务没有交给新版执行。请先检查迁移状态，不要重复导入。", "舊資料繼承尚未完成，原資料仍保留；舊定時任務沒有交給新版執行。請先檢查遷移狀態，不要重複匯入。"],
  ["ws.notice.inheritanceRolledBack", "This legacy data inheritance was rolled back. Original data is retained; restarting will not repeat it automatically.", "已撤回本次旧资料继承，原版资料仍保留；不会在重启后自动重做。", "已撤回本次舊資料繼承，原版資料仍保留；不會在重新啟動後自動重做。"],
  ["ws.notice.modeMismatch", "The workspace mode does not match. No other engine was selected.", "工作空间模式不符，没有改接其他引擎。", "工作空間模式不符，沒有改接其他引擎。"],
  ["ws.notice.workspaceUnavailable", "This workspace is unavailable.", "这个工作空间不可用。", "這個工作空間無法使用。"],
  ["ws.notice.syncing", "Syncing the latest status. Background tasks will not be resent or marked as failed because of this wait.", "正在同步最新状态；后台任务不会因此重送或被判为失败。", "正在同步最新狀態；背景任務不會因此重送或被判為失敗。"],
  ["ws.notice.selectWorkspace", "Select a workspace first.", "请先选择工作空间。", "請先選擇工作空間。"],
  ["ws.notice.scopeChanged", "The original workspace view changed. The request was not resent automatically.", "原工作空间视图已切换，未自动重送。", "原工作空間檢視已切換，未自動重送。"],
  ["ws.notice.localConfirmationExpired", "The original local installation confirmation expired.", "原本机安装确认已失效。", "原本機安裝確認已失效。"],
  ["ws.notice.installViewChanged", "The original installation proposal’s view changed.", "原安装提案的视图已切换。", "原安裝提案的檢視已切換。"],
  ["ws.notice.installScopeMismatch", "This installation confirmation does not belong to the current workspace.", "安装确认不属于当前空间。", "安裝確認不屬於目前空間。"],
  ["ws.notice.syntheticRequired", "Enable a synthetic connection in this workspace first.", "请先在这个工作空间启用合成连接。", "請先在這個工作空間啟用合成連接。"],
  ["ws.notice.connectionRequired", "Configure a model connection in this workspace first.", "请先在这个工作空间配置模型连接。", "請先在這個工作空間設定模型連接。"],
  ["ws.notice.resumeBudget", "The original task’s continuation budget is unavailable. Nothing was rerun, no model call was added and the chat is unchanged. Check the outcome and budget reason first.", "原任务的续跑预算不可用；没有重跑、增加模型调用或改写原聊天。请先检查结果与预算原因。", "原任務的續跑預算無法使用；沒有重跑、增加模型呼叫或改寫原聊天。請先檢查結果與預算原因。"],
  ["ws.notice.acceptancePending", "Checking whether the original request was received. It will not be resent.", "尚在确认原请求是否已接收；不会重新发送。", "尚在確認原請求是否已接收；不會重新傳送。"],
  ["ws.notice.invalidReceipt", "The receipt does not match the original workspace, generation, colleague or request. It was not applied.", "回执与原工作空间、代次、同事或请求不符，已拒绝应用。", "回執與原工作空間、代次、同事或請求不符，已拒絕套用。"],
  ["ws.notice.receiptPending", "No confirmed receipt for the original request yet. The message is retained and will not be resent automatically.", "尚未找到可确认的原请求回执；保留原消息，不自动重送。", "尚未找到可確認的原請求回執；保留原訊息，不自動重送。"],
  ["ws.notice.requestRejected", "The original request was not accepted. No model call was added. Check the original task’s budget and status.", "原请求未获接纳；没有新增模型调用。请检查原任务的预算与状态。", "原請求未獲接納；沒有新增模型呼叫。請檢查原任務的預算與狀態。"],
  ["ws.notice.receiptUnavailable", "The original request’s receipt is unavailable for now. The message is retained and will not be resent automatically.", "暂未取得原请求回执；消息保留，不自动重送。", "暫未取得原請求回執；訊息保留，不自動重送。"],
  ["ws.notice.approvalPending", "Checking the confirmation result read-only. It will not be submitted again.", "正在只读核对确认结果；不会重复提交。", "正在唯讀核對確認結果；不會重複提交。"],
  ["ws.notice.cancelPending", "Checking the cancellation status read-only. The task will not run again.", "正在只读核对取消状态；不会重新执行任务。", "正在唯讀核對取消狀態；不會重新執行任務。"],
] as const;
