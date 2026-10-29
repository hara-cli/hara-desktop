# Soft Dark 建同事确认卡过期／拒绝态 — Desk impl

时间：2026-10-30 Asia/Taipei  
授权：Jeff t1060u；合／装／正式闸另批  
Branch：`feat/soft-dark-approval-settled-20261030`＠base `8f31198`

## 做了什么

- i18n：`ws.approval.settledKicker`／`settledDeclined`／`settledExpired`／`settledAborted`（en／简／繁）
- Transcript：解析 `agent_create` 软拒 JSON，brief 下渲染只读结算卡（无按钮）；成功 ops 仍隐藏
- CSS：`.wsd-approval-settled` 轻量样式
- 测：三语结算卡可见、无按钮、created:true 不出现结算卡

## sha256

- `src/WorkspaceLocalDev.tsx`: `5ea1e02419db1b7d6135eceac08e9f96556e08428812d0c487220a86b081d99e`
- `src/workspace-i18n.ts`: `a129d00ffaa500da7fd32a67ae560035001344f909d6bb88e89d1b38bd4ca154`
- `src/workspace-local-dev.css`: `c5d7b8ed64de4152086f42df59cfa5a93754095fe1ab32f96607e463cbd9d226`
- `test/workspace-transcript-groups.test.mjs`: `a30f1147ebba8c90be519832c3446764340dd544f5546df658a4b577195205c5`

## 验证

- `npx tsc --noEmit` 绿
- `test/workspace-transcript-groups.test.mjs` 全绿（含新结算卡测）
