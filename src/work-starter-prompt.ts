export type WorkKind = "general" | "presentation" | "spreadsheet" | "document" | "summary";

/**
 * Turn a novice's outcome statement into a bounded first turn. The generic workbench input must stay
 * generic until the user deliberately selects a specialist card.
 */
export function buildWorkPrompt(kind: WorkKind, brief: string, locale: "en" | "zh"): string {
  const goal = brief.trim();
  if (locale === "en") {
    if (kind === "presentation") {
      return `Help me create a presentation: ${goal}

First confirm the audience, setting, central takeaway, source material, and required outputs. Then give me a short task brief, narrative arc, and slide outline before producing slides. Keep one claim per slide and add a visual-quality review before export. Clearly distinguish an editable PPTX from a visual-fidelity PPTX or PDF. Before producing files, verify that the required presentation capability is installed; if it is unavailable, explain what is missing instead of claiming an export succeeded.`;
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
    return `请帮我制作一份演示文稿：${goal}

先确认受众、使用场景、核心结论、资料来源和交付格式，再给我一张简短任务简报、叙事结构和页纲，确认后再制作页面。每页只讲一个结论，导出前做一次视觉质量审查，并明确区分“可编辑 PPTX”和“视觉保真 PPTX/PDF”。制作文件前先确认演示文稿能力已经安装；如果不可用，要说明缺少什么，不能假装导出成功。`;
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
