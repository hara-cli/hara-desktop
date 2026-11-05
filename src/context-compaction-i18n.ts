export const CONTEXT_COMPACTION_KEYS = [
  ["ws.compaction.completed", "Earlier content has been summarized", "较早的内容已整理为摘要", "較早的內容已整理為摘要"],
  ["ws.compaction.failed", "Summary did not finish; original conversation retained", "整理未完成，原对话已保留", "整理未完成，原對話已保留"],
  ["ws.compaction.pending", "Summary result awaits confirmation", "整理结果待确认", "整理結果待確認"],
  ["ws.compaction.reference", "For reference only. Full original history is retained. This summary does not confirm an action or approval.", "仅供参考，完整原历史仍保留。摘要不代表操作完成或已获批准。", "僅供參考，完整原歷史仍保留。摘要不代表操作完成或已獲批准。"],
  ["ws.compaction.goals", "Goals", "目标", "目標"],
  ["ws.compaction.decisions", "Decisions", "已决事项", "已決事項"],
  ["ws.compaction.unfinished", "Open work", "未完成事项", "未完成事項"],
  ["ws.compaction.references", "Key files and projects", "关键文件与项目", "關鍵檔案與專案"],
  ["ws.compaction.cards", "Latest confirmation card status", "最近确认卡状态", "最近確認卡狀態"],
  ["ws.compaction.recent", "Recent messages", "最近消息", "最近訊息"],
  ["ws.compaction.unknown", "unknown", "未知", "未知"],
  ["ws.compaction.cost", "Summary requests: {calls}; tokens in {input}, out {output}, cached {cached}.", "摘要请求 {calls} 次；token 输入 {input}，输出 {output}，缓存 {cached}。", "摘要請求 {calls} 次；token 輸入 {input}，輸出 {output}，快取 {cached}。"],
] as const;
