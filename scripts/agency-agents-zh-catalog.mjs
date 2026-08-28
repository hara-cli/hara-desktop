/**
 * Reviewed bridge between the pinned English Agency Agents catalog and the pinned Chinese
 * localization. Keep fuzzy/semantic decisions explicit: generation must never silently guess that
 * two roles are the same, because a mistaken merge changes what a user believes they are hiring.
 */

export const AGENCY_AGENTS_ZH_REVISION = "972452cdedef8d04fed4a8dd1dc10623e33ed412";
export const AGENCY_AGENTS_ZH_EXPECTED_COUNT = 276;

export const AGENCY_AGENTS_ZH_DIVISIONS = [
  "academic",
  "company",
  "design",
  "engineering",
  "finance",
  "game-development",
  "gis",
  "hr",
  "legal",
  "marketing",
  "paid-media",
  "product",
  "project-management",
  "sales",
  "security",
  "spatial-computing",
  "specialized",
  "supply-chain",
  "support",
  "testing",
];

/** Chinese files whose upstream role moved or was renamed. */
export const AGENCY_AGENTS_ZH_RENAMED_PATHS = new Map([
  ["marketing/marketing-bilibili-strategist.md", "marketing/marketing-bilibili-content-strategist.md"],
  ["supply-chain/supply-chain-strategist.md", "specialized/supply-chain-strategist.md"],
]);

/**
 * Reviewed semantic duplicates. The Chinese record is consumed but not added as a second hireable
 * role. Its localization only fills the target when that target has no exact Chinese translation.
 */
export const AGENCY_AGENTS_ZH_SEMANTIC_DUPLICATES = new Map([
  ["company/chief-financial-officer.md", "specialized/chief-financial-officer.md"],
  ["company/chief-of-staff.md", "specialized/specialized-chief-of-staff.md"],
  ["engineering/engineering-security-engineer.md", "security/security-appsec-engineer.md"],
  ["engineering/engineering-threat-detection-engineer.md", "security/security-threat-detection-engineer.md"],
  ["marketing/marketing-ecommerce-operator.md", "marketing/marketing-china-ecommerce-operator.md"],
  ["marketing/marketing-wechat-operator.md", "marketing/marketing-wechat-official-account.md"],
  ["marketing/marketing-xiaohongshu-operator.md", "marketing/marketing-xiaohongshu-specialist.md"],
  ["specialized/prompt-engineer.md", "engineering/engineering-prompt-engineer.md"],
  ["specialized/technical-translator-agent.md", "specialized/language-translator.md"],
  ["support/support-recruitment-specialist.md", "specialized/recruitment-specialist.md"],
]);

/**
 * Concise English catalog copy for the genuinely China-specific roles. The full role instructions
 * remain in the versioned source; these strings are presentation metadata, not system prompts.
 */
export const AGENCY_AGENTS_ZH_NEW_ROLE_ENGLISH = {
  "academic/academic-study-planner.md": {
    name: "Study Planner",
    description: "Builds evidence-based study plans for major Chinese exams and lifelong learning, then adapts them from measured progress.",
  },
  "company/chief-executive-officer.md": {
    name: "Chief Executive Officer",
    description: "Owns strategic direction, resource allocation, organizational cadence, and accountable decisions under uncertainty.",
  },
  "company/chief-marketing-officer.md": {
    name: "Chief Marketing Officer",
    description: "Leads positioning, channel mix, marketing investment, measurable growth, and long-term brand equity.",
  },
  "company/chief-operating-officer.md": {
    name: "Chief Operating Officer",
    description: "Turns strategy into operating rhythms, processes, metrics, and reliable cross-company execution.",
  },
  "company/chief-product-officer.md": {
    name: "Chief Product Officer",
    description: "Owns product strategy, roadmap tradeoffs, and the order in which customer and business value are delivered.",
  },
  "company/chief-technology-officer.md": {
    name: "Chief Technology Officer",
    description: "Leads technology strategy, architecture, engineering organization, and explicit tradeoffs between speed and durability.",
  },
  "design/design-video-prompt-engineer.md": {
    name: "Video Prompt Engineer",
    description: "Turns a creative idea into production-ready cinematic prompts for leading text-to-video systems, including motion, sound, constraints, and cost.",
  },
  "engineering/engineering-dingtalk-integration-developer.md": {
    name: "DingTalk Integration Developer",
    description: "Builds secure DingTalk bots, mini apps, approval automation, connectors, and enterprise integrations across the Alibaba ecosystem.",
  },
  "engineering/engineering-embedded-linux-driver-engineer.md": {
    name: "Embedded Linux Driver Engineer",
    description: "Develops Linux kernel drivers and BSPs across device trees, buses, DMA, interrupts, bootloaders, and embedded build systems.",
  },
  "engineering/engineering-fpga-digital-design-engineer.md": {
    name: "FPGA / ASIC Digital Design Engineer",
    description: "Designs and verifies digital hardware with HDL, SoC buses, timing closure, FPGA toolchains, and high-level synthesis.",
  },
  "engineering/engineering-iot-solution-architect.md": {
    name: "IoT Solution Architect",
    description: "Designs secure end-to-end IoT systems spanning device connectivity, edge computing, cloud platforms, OTA, and data pipelines.",
  },
  "engineering/engineering-mechanical-design-engineer.md": {
    name: "Mechanical Design Engineer",
    description: "Produces manufacturable mechanical designs, calculations, drawings, and bills of materials aligned with GB, ISO, and JIS standards.",
  },
  "engineering/engineering-network-engineer-china.md": {
    name: "China Network Engineer",
    description: "Designs and troubleshoots enterprise networks built on Huawei, H3C, and Ruijie equipment with Xinchuang and MLPS 2.0 considerations.",
  },
  "engineering/engineering-pc-host-engineer.md": {
    name: "Industrial Desktop Host Engineer",
    description: "Builds Qt desktop control applications for serial, Modbus, CAN, and TCP devices with real-time visualization and cross-platform delivery.",
  },
  "finance/finance-financial-forecaster.md": {
    name: "Financial Forecaster",
    description: "Models revenue, cash flow, burn, fundraising, and scenarios so growing companies can plan through uncertainty.",
  },
  "finance/finance-fraud-detector.md": {
    name: "China Fraud Risk Analyst",
    description: "Designs fraud, AML, and payment-risk controls for Alipay, WeChat Pay, UnionPay, credit, and internet-finance scenarios.",
  },
  "finance/finance-hk-stock-compliance-reviewer.md": {
    name: "Hong Kong Securities Compliance Reviewer",
    description: "Reviews listing, disclosure, connected-transaction, and governance obligations under current HKEX and SFC requirements.",
  },
  "finance/finance-invoice-manager.md": {
    name: "China Invoice Manager",
    description: "Manages the Chinese VAT invoice lifecycle, Golden Tax workflows, three-way matching, reimbursement controls, and tax compliance.",
  },
  "hr/hr-performance-reviewer.md": {
    name: "Performance Management Specialist",
    description: "Designs fair China-context performance systems across OKRs, KPIs, calibration, 360 feedback, and improvement plans.",
  },
  "hr/hr-recruiter.md": {
    name: "China Full-Cycle Recruiter",
    description: "Runs compliant recruiting across Boss Zhipin, Liepin, Lagou, campus hiring, interviews, pipelines, and onboarding handoff.",
  },
  "legal/legal-contract-reviewer.md": {
    name: "China Contract Reviewer",
    description: "Reviews commercial contracts against the PRC Civil Code, electronic-signature practice, remedies, and dispute-resolution risk.",
  },
  "legal/legal-policy-writer.md": {
    name: "China Policy Writer",
    description: "Drafts internal policies, privacy notices, and user agreements aligned with the PIPL, Data Security Law, and Cybersecurity Law.",
  },
  "marketing/marketing-daily-news-briefing.md": {
    name: "News Intelligence Officer",
    description: "Collects, cross-checks, classifies, and structures current Chinese and global news into briefs ready for downstream work.",
  },
  "marketing/marketing-knowledge-commerce-strategist.md": {
    name: "Knowledge Commerce Strategist",
    description: "Designs and grows paid knowledge products across major Chinese creator platforms, pricing, distribution, and member operations.",
  },
  "marketing/marketing-weixin-channels-strategist.md": {
    name: "Weixin Channels Strategist",
    description: "Plans Weixin Channels content, livestream commerce, social recommendation, private-domain conversion, and ecosystem coordination.",
  },
  "specialized/authenticity-appraiser.md": {
    name: "Authenticity Appraiser",
    description: "Explains authentication and valuation frameworks for luxury goods, watches, sneakers, toys, and collectibles while stating remote-assessment limits.",
  },
  "specialized/gaokao-college-advisor.md": {
    name: "Gaokao College Application Advisor",
    description: "Builds evidence-based Chinese university application plans from rank, subject constraints, admission rules, and reach-match-safety choices.",
  },
  "specialized/livestock-archive-auditor.md": {
    name: "Livestock Records Auditor",
    description: "Audits Chinese livestock workbooks and daily reports for missing, inconsistent, and non-FIFO medicine, feed, treatment, and production records.",
  },
  "specialized/specialized-ai-policy-writer.md": {
    name: "China AI Governance Specialist",
    description: "Builds operational AI governance aligned with Chinese generative-AI, algorithm-filing, deep-synthesis, safety-assessment, and ethics requirements.",
  },
  "specialized/specialized-meeting-assistant.md": {
    name: "Meeting Effectiveness Specialist",
    description: "Turns meetings across Feishu, DingTalk, and Tencent Meeting into clear agendas, decisions, minutes, and owned follow-up actions.",
  },
  "specialized/specialized-pricing-optimizer.md": {
    name: "Dynamic Pricing Strategist",
    description: "Optimizes price, promotion, margin, and competitive response across major Chinese ecommerce marketplaces and sales events.",
  },
  "specialized/specialized-risk-assessor.md": {
    name: "China Enterprise Risk Assessor",
    description: "Assesses internal-control, audit, ESG, state-owned-enterprise, and supply-chain risks in a China business context.",
  },
  "specialized/travel-planner.md": {
    name: "China Travel Planner",
    description: "Creates executable domestic and outbound itineraries for Chinese travelers across transport, lodging, documents, budget, and peak-season risk.",
  },
  "supply-chain/supply-chain-garment-factory-planning-engineer.md": {
    name: "Garment Factory Planning Engineer",
    description: "Plans multi-site garment factories across capacity, layout, equipment, lean flow, manufacturability, and multi-country compliance.",
  },
  "supply-chain/supply-chain-inventory-forecaster.md": {
    name: "Inventory Forecaster",
    description: "Forecasts demand, safety stock, and replenishment for Chinese ecommerce cycles to balance availability and working capital.",
  },
  "supply-chain/supply-chain-route-optimizer.md": {
    name: "Logistics Route Optimizer",
    description: "Optimizes Chinese parcel, local-delivery, cold-chain, and cross-border routes against service levels and total cost.",
  },
  "supply-chain/supply-chain-vendor-evaluator.md": {
    name: "Vendor Evaluation Specialist",
    description: "Evaluates and governs suppliers across sourcing, factory audits, quality systems, commercial terms, and platforms such as 1688.",
  },
  "testing/testing-embedded-qa-engineer.md": {
    name: "Embedded QA Engineer",
    description: "Verifies embedded systems through hardware-in-the-loop, firmware automation, OTA regression, EMC/ESD planning, fault injection, and production fixtures.",
  },
};

/** Reviewed Chinese titles for newer upstream roles that the pinned Chinese checkout has not translated. */
export const AGENCY_AGENTS_UPSTREAM_ZH_TITLES = {
  "academic/academic-statistician.md": "统计学家",
  "design/design-ui-finish-gate-reviewer.md": "UI 完成度验收专家",
  "engineering/engineering-api-platform-engineer.md": "API 平台工程师",
  "engineering/engineering-data-visualization-engineer.md": "数据可视化工程师",
  "engineering/engineering-database-reliability-engineer.md": "数据库可靠性工程师",
  "engineering/engineering-desktop-app-engineer.md": "桌面应用工程师",
  "engineering/engineering-developer-tooling-engineer.md": "开发者工具工程师",
  "engineering/engineering-drupal-performance.md": "Drupal 性能工程师",
  "engineering/engineering-finops-engineer.md": "云成本治理工程师",
  "engineering/engineering-gaussdb-expert.md": "GaussDB 专家",
  "engineering/engineering-i18n-engineer.md": "国际化工程师",
  "engineering/engineering-identity-access-engineer.md": "身份与访问管理工程师",
  "engineering/engineering-iot-fleet-engineer.md": "IoT 设备群管理工程师",
  "engineering/engineering-llm-post-training-engineer.md": "大模型后训练工程师",
  "engineering/engineering-mobile-release-engineer.md": "移动应用发布工程师",
  "engineering/engineering-network-engineer.md": "网络工程师",
  "engineering/engineering-payments-billing-engineer.md": "支付与计费工程师",
  "engineering/engineering-privacy-engineer.md": "隐私工程师",
  "engineering/engineering-rag-pipeline-engineer.md": "RAG 管线工程师",
  "engineering/engineering-realtime-collaboration-engineer.md": "实时协作工程师",
  "engineering/engineering-rust-refactoring-specialist.md": "Rust 重构专家",
  "engineering/engineering-search-relevance-engineer.md": "搜索相关性工程师",
  "engineering/engineering-section-508-specialist.md": "Section 508 无障碍合规专家",
  "engineering/engineering-uswds-developer.md": "USWDS 开发工程师",
  "engineering/engineering-video-streaming-engineer.md": "视频流媒体工程师",
  "engineering/engineering-webassembly-engineer.md": "WebAssembly 工程师",
  "engineering/engineering-wordpress-performance.md": "WordPress 性能工程师",
  "game-development/economy-designer.md": "游戏经济系统设计师",
  "healthcare/healthcare-clinical-evidence-agent.md": "临床证据专家",
  "healthcare/healthcare-innovation-strategist.md": "医疗创新策略师",
  "healthcare/healthcare-sovereign-health-systems-agent.md": "主权医疗系统专家",
  "security/security-ai-generated-code-auditor.md": "AI 生成代码审计师",
  "security/security-secrets-credential-engineer.md": "密钥与凭据安全工程师",
  "specialized/chief-financial-officer.md": "首席财务官",
  "specialized/customer-service.md": "客户服务专员",
  "specialized/healthcare-aging-parent-care-companion.md": "老年父母照护助手",
  "specialized/resume-tailor.md": "简历定制专家",
  "specialized/sales-outreach.md": "销售外联专家",
  "specialized/specialized-chief-of-staff.md": "幕僚长",
  "specialized/specialized-codebase-archaeologist.md": "代码库考古专家",
  "specialized/specialized-fedramp-rmf-compliance.md": "FedRAMP / RMF 合规专家",
  "testing/testing-test-automation-engineer.md": "测试自动化工程师",
};
