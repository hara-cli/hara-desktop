import { lazy, Suspense } from "react";

const App = lazy(() => import("./App"));
const ProviderSettingsPreview = lazy(() => import("./ProviderSettingsPreview").then(module => ({ default: module.ProviderSettingsPreview })));
const WorkStarter = lazy(() => import("./WorkStarter").then(module => ({ default: module.WorkStarter })));
const MailboxPreview = import.meta.env.DEV ? lazy(() => import("./MailboxSettingsPreview").then(module => ({ default: module.MailboxSettingsPreview }))) : null;
const ConversationPreview = import.meta.env.DEV ? lazy(() => import("./ConversationPreview")) : null;
const TalentMarketPreview = lazy(() => import("./TalentMarket"));
const AutomationPreview = lazy(() => import("./AutomationPreview"));

/** Loaded only after the native host confirms HARA_DESKTOP_LEGACY_ENTRY=1.
 * The old workbench, Groups, channel preview, Mailbox/Desk and organization surface
 * stay intact here. DEV or a preview query alone never opens this entry.
 */
export default function LegacyDesktopEntry() {
  const params = new URLSearchParams(window.location.search);
  const workbenchPreview = import.meta.env.DEV && params.get("preview") === "workbench";
  const providersPreview = import.meta.env.DEV && params.get("preview") === "providers";
  const mailboxPreview = import.meta.env.DEV && params.get("preview") === "mailbox";
  const talentPreview = import.meta.env.DEV && params.get("preview") === "talent";
  const automationPreview = import.meta.env.DEV && params.get("preview") === "automation";
  const conversationPreview = import.meta.env.DEV && params.get("preview") === "conversation";
  return <Suspense fallback={<div role="status">正在打開舊版介面…</div>}>
    {mailboxPreview && MailboxPreview ? (
      <MailboxPreview locale={params.get("locale") === "en" ? "en" : "zh"} scenario={params.get("scenario")} />
    ) : conversationPreview && ConversationPreview ? (
      <ConversationPreview locale={params.get("locale") === "en" ? "en" : "zh"}
        theme={params.get("theme")} scenario={params.get("scenario")} extension={params.get("extension") === "1"} />
    ) : automationPreview ? (
      <AutomationPreview locale={params.get("locale") === "en" ? "en" : "zh"}
        layout={params.get("layout") === "settings" ? "settings" : undefined}
        section={params.get("section") === "appearance" ? "appearance" : undefined}
        sidebarExpanded={params.get("advanced") === "1"} />
    ) : talentPreview ? (
      <TalentMarketPreview locale={params.get("locale") === "en" ? "en" : "zh"} hiredBlueprintIds={[]}
        onClose={() => {}} onCustomHire={() => {}} onHire={() => {}} />
    ) : providersPreview ? (
      <ProviderSettingsPreview locale={params.get("locale") === "en" ? "en" : "zh"} scenario={params.get("scenario")} />
    ) : workbenchPreview ? (
      <div className="app"><main className="chat im"><div className="anchor">Hara · visual QA preview</div>
        <div className="workstarter-scroll"><WorkStarter locale={params.get("locale") === "en" ? "en" : "zh"}
          busy={false} onStart={async () => {}} onPickFiles={async () => []} onPickDirectory={async () => []}
          onPasteImages={async () => []} onDropPaths={async () => []} /></div>
      </main></div>
    ) : <App />}
  </Suspense>;
}
