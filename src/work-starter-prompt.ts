export type WorkKind = "general" | "presentation" | "spreadsheet" | "document" | "summary";

/**
 * Turn a novice's outcome statement into a bounded first turn. The generic workbench input must stay
 * generic until the user deliberately selects a specialist card.
 */
export function buildWorkPrompt(kind: WorkKind, brief: string, locale: "en" | "zh"): string {
  const goal = brief.trim() || (locale === "zh"
    ? "请先审阅本轮附加的资料，说明你识别到的内容，再建议最合适的交付结果"
    : "Review the attached material, tell me what you found, and recommend the most useful deliverable");
  if (locale === "en") {
    if (kind === "presentation") {
      return `Enter Hara Presentation Specialist mode for this request: ${goal}

Infer the audience, setting, decision, central takeaway, source material, and required outputs from the request and attachments. Ask only when a missing fact would materially change the deck; otherwise do not pause for another confirmation. Use Hara's native presentation capability to create an editable draft early so it opens in the right work surface, then revise that same Artifact instead of creating parallel copies. Keep one evidence-backed claim and takeaway per slide, keep slides readable, never invent evidence, and record external sources in notes. Before export, validate the exact structured revision and rendered preview. Do not configure or invoke a separate vision helper for ordinary PPT work; image-based review is optional only when explicitly requested and the selected main model natively accepts images. Clearly distinguish semantic-editable PPTX from visual-fidelity browser HTML/PDF, and never claim an export succeeded until the capability returns a verified receipt.`;
    }
    if (kind === "spreadsheet") {
      return `Help me complete this spreadsheet job: ${goal}

First confirm the input files, required calculations, output format, and acceptance checks. Preserve the original, explain any fidelity limits, validate formulas and data types, and produce an editable deliverable. Verify that the required spreadsheet capability is available before promising an export.`;
    }
    if (kind === "document") {
      return `Help me create this document: ${goal}

First confirm the audience, purpose, source material, structure, output format, and acceptance checks. Draft for review before final export and preserve an editable source. Verify that the required document capability is available before promising an export.`;
    }
    if (kind === "summary") {
      return `Help me review and organize these materials: ${goal}

First confirm the source files, desired decision or outcome, and output format. Separate evidence from inference, identify missing information, and finish with conclusions and concrete next actions.`;
    }
    return `Help me complete this job: ${goal}

First restate the intended outcome in plain language and identify only the missing information that materially affects the result. Propose a short plan and acceptance checks before changing files, preserve the originals, and make the final deliverable easy to review.`;
  }

  if (kind === "presentation") {
    return `请进入 Hara PPT 专业模式完成这个任务：${goal}

从请求和附件中整理受众、使用场景、要支持的决策、核心结论、资料来源和交付格式；只有缺失信息会实质改变结果时才提问，资料足够就不要再等一次确认。使用 Hara 原生演示能力尽早生成可编辑草稿并打开右侧工作区，后续持续修改同一个 Artifact，不要制造多个平行副本。每页只讲一个有依据的结论并给出清晰标题，控制信息密度，不得编造证据，外部来源写入备注。导出前必须校验当前结构化版本和同源渲染结果。普通 PPT 制作不得另行配置或调用视觉辅助模型；只有用户明确要求且当前主模型原生支持图片时，才增加图像复核。明确区分“语义可编辑 PPTX”与“视觉保真浏览器 HTML/PDF”，能力没有返回已验证回执前不能声称导出成功。`;
  }
  if (kind === "spreadsheet") {
    return `请帮我完成这项表格工作：${goal}

先确认输入文件、计算口径、交付格式和验收条件。保留原文件，说明格式兼容边界，校验公式与数据类型，并交付可继续编辑的文件。承诺导出前先确认表格能力可用。`;
  }
  if (kind === "document") {
    return `请帮我制作这份文档：${goal}

先确认受众、用途、资料来源、结构、交付格式和验收条件。先给出可审阅的草稿，再导出最终文件，并保留可编辑源稿。承诺导出前先确认文档能力可用。`;
  }
  if (kind === "summary") {
    return `请帮我审阅并整理这些资料：${goal}

先确认资料范围、要支持的决策或结果，以及交付格式。把事实证据与推断分开，指出缺失信息，最后给出结论和可执行待办。`;
  }
  return `请帮我完成这项工作：${goal}

先用通俗语言复述目标，只询问会实质影响结果的缺失信息，再给出简短计划和验收条件。修改文件前保留原件，最终交付物要便于我检查。`;
}
