// Lightweight i18n — en/zh, aligned with hara.run's bilingual docs. System locale by default,
// manual toggle persisted in localStorage. No dependency; the string set is tiny.
export type Locale = "en" | "zh";

const dict = {
  en: {
    connecting: "connecting to hara serve…",
    noServer: "no running `hara serve` found",
    lost: "connection lost — is `hara serve` still running?",
    startServe: "start hara serve",
    retry: "retry",
    workdir: "working directory",
    create: "create",
    cancel: "cancel",
    pickSession: "pick a session or start a new one",
    thinking: "thinking…",
    working: "▍working…",
    send: "send",
    stop: "stop",
    placeholder: "message hara… (Enter to send, Shift+Enter for newline)",
    approvalTitle: "approval needed",
    allow: "allow",
    always: "always allow",
    deny: "deny",
    plugins: "plugins",
    skills: "skills",
    noPlugins: "no plugins installed — `hara plugin install <source>`",
    loading: "loading…",
    enabled: "enabled",
    disabled: "disabled",
    untitled: "(untitled)",
    newLabel: "new",
    tokens: "tokens",
    assistant: "Assistant",
    newHere: "+ session here",
    openProject: "+ open project",
    removeProject: "remove from list (sessions are kept)",
    // rail / zones
    zoneChat: "Assistant",
    zoneProjects: "Projects",
    zoneSettings: "Settings",
    anchorAssistant: "To · your assistant (synced with WeChat)",
    anchorRepo: "In · ",
    automations: "Automations",
    autoNone: "no automated runs yet",
    autoNeedsUpdate: "server too old for the automation timeline — update hara and restart serve",
    continueChat: "continue as conversation",
    // empty state
    heroTag: "one person, a team of agents",
    cardChatTitle: "💬 Just chat",
    cardChatBody: "Boss it around like a messaging app. Continues on your phone.",
    cardChatBtn: "Start talking",
    cardProjTitle: "📁 Open a project",
    cardProjBody: "Pick a folder and let it work in there — code, docs, anything.",
    cardProjBtn: "Choose folder…",
    starting: "waking the local engine…",
    showDetails: "show details",
    // settings
    setLang: "Language",
    setServer: "Engine",
    setPlugins: "Capabilities (plugins)",
    setSecurity: "Security",
    apprHint: "full-auto = it may edit files and run commands without asking",
    history: "History",
  },
  zh: {
    connecting: "正在连接 hara serve…",
    noServer: "没有找到运行中的 `hara serve`",
    lost: "连接断开 —— `hara serve` 还在运行吗?",
    startServe: "启动 hara serve",
    retry: "重试",
    workdir: "工作目录",
    create: "创建",
    cancel: "取消",
    pickSession: "选择一个会话,或新建一个",
    thinking: "思考中…",
    working: "▍工作中…",
    send: "发送",
    stop: "停止",
    placeholder: "给 hara 发消息…(Enter 发送,Shift+Enter 换行)",
    approvalTitle: "需要审批",
    allow: "允许",
    always: "总是允许",
    deny: "拒绝",
    plugins: "插件",
    skills: "技能",
    noPlugins: "尚未安装插件 —— `hara plugin install <source>`",
    loading: "加载中…",
    enabled: "已启用",
    disabled: "已停用",
    untitled: "(未命名)",
    newLabel: "新",
    tokens: "tokens",
    assistant: "助手",
    newHere: "+ 在此目录新会话",
    openProject: "+ 打开项目",
    removeProject: "从列表移除(会话保留)",
    // rail / zones
    zoneChat: "助手",
    zoneProjects: "项目",
    zoneSettings: "设置",
    anchorAssistant: "发往 · 随身助手(与手机微信同步)",
    anchorRepo: "当前 · ",
    automations: "自动任务",
    autoNone: "还没有自动任务记录",
    autoNeedsUpdate: "服务端过旧,时间线需要升级 hara 并重启 serve",
    continueChat: "继续这个对话",
    // empty state
    heroTag: "一个人,一支 agent 团队",
    cardChatTitle: "💬 随手聊聊",
    cardChatBody: "像发消息一样支使它,出门手机上也能继续。",
    cardChatBtn: "开始对话",
    cardProjTitle: "📁 打开一个项目",
    cardProjBody: "选个目录,让它在里面干活——代码、文档都行。",
    cardProjBtn: "选择目录…",
    starting: "正在唤起本地引擎…",
    showDetails: "查看详情",
    // settings
    setLang: "语言",
    setServer: "引擎",
    setPlugins: "能力(插件)",
    setSecurity: "安全",
    apprHint: "full-auto = 它可以不问你就改文件、跑命令",
    history: "历史会话",
  },
} as const;

export type Key = keyof typeof dict.en;

export function detectLocale(): Locale {
  const saved = localStorage.getItem("hara.locale");
  if (saved === "en" || saved === "zh") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function saveLocale(l: Locale): void {
  localStorage.setItem("hara.locale", l);
}

export function makeT(locale: Locale) {
  return (k: Key): string => dict[locale][k];
}
