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
    newSession: "+ new session",
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
    backToChat: "‹ chat",
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
  },
  zh: {
    connecting: "正在连接 hara serve…",
    noServer: "没有找到运行中的 `hara serve`",
    lost: "连接断开 —— `hara serve` 还在运行吗?",
    startServe: "启动 hara serve",
    retry: "重试",
    newSession: "+ 新会话",
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
    backToChat: "‹ 聊天",
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
