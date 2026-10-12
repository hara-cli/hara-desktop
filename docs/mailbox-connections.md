# Mailboxes, users and Desk work

Settings → Connections is the self-service binding entry for a selected company
Space. The mailbox belongs to the user; admins can also configure company mail.
One user can have several Agents. Projects grant permissions to a user or a specific
Agent. Use the existing company invitation flow for new users; no second login
system is introduced.

Enter the exact email address, IMAP/SMTP host/port/TLS or STARTTLS and a dedicated
client authorization code. Feishu settings can be filled with one button. There
is no required provider selector or Tencent authorization entry in new bindings.
Passwords stay on the actual receiving host, not in Desk or browser storage.
After verification, receipt starts paused and the user enables it deliberately.
The local main Bot is the enrolled Desk Agent; labels inside a message never select
another identity. Empty inbox verification does not prove body-read permissions.

An updated Engine must advertise `mail.runtime.status`, `mail.connections.list`, `mail.command` and
`desk.taskbus.request`; Desk must advertise `taskbus.v1` (0.9.0+). Older Engines
show an upgrade notice. Each receiver host needs Python 3 and the canonical global
`feishu-communicate` skill with configurable IMAP/SMTP commands. Desktop does not
install that dependency automatically. CLI/Desktop release versions are assigned
by the unified release owner; this feature was not part of CLI 0.186.1.
Settings probes only local command help and disables local binding until these
prerequisites are ready. Desk tickets and tasks remain usable without them.
Changing mail servers or enrollment requires an explicit client password again;
leaving it blank never forwards a stored password to different servers.

The page supports user administration, user/Agent project grants, ticket/task
inspection, directed child dispatch, result evidence, independent review, release
verification and closure. Claims/results are submitted by execution Agents through
Desk MCP/CLI. High-risk automatic execution stays closed. Email enters as untrusted
feedback, not executable instructions. No closed Codex/Claude window is awakened.

Web and Desktop share Desk records through short HTTPS polling. Offline copies are
private, scoped to the company identity and read-only. Failed authorization never
uses cached permission. Changing company resets form state and rejects late reads.
Binding metadata, pause/unbind and approved work sync; passwords do not. To receive
on another host, explicitly verify the same mailbox there. One fenced receiver
lease prevents two hosts from consuming it concurrently.

Lock-screen receipt requires Hara Engine to remain running. Sleep or application
exit pauses processing; recovery catches up afterward. Server receipt requires an
enrolled, authorized persistent Hara worker on that server, separately from Desk.
No real mailbox or server worker is activated by this change.

Mail drafts show exact sender, recipients, subject, plaintext body and SHA-256.
Only human confirmation queues SMTP. Unknown outcomes require manual sent-mail
verification and are never automatically resent. SMTP accepted is not delivered.
This version does not download attachments or send attachments/HTML/BCC.
Client-password transport does not cover OAuth-only accounts.

For UI verification, development-only `?preview=mailbox&locale=zh` (or `en`) uses
synthetic local fixtures and performs no authorization or writes. `scenario=empty`
and `scenario=old-engine` cover empty and compatibility states.
`scenario=missing-mail-runtime` covers missing receiver prerequisites.
Production bundles do not enable this preview. Mailbox tests and the existing full suite accompany the
change; a native signed release and actual mailbox round-trip are separate gates.

On 2026-10-12 a native Chrome fixture check verified English prerequisite warnings,
disabled password/bind/sync controls, and Chinese task/evidence/outgoing-confirmation
details. The independent window was narrowed from 3378px to 1658px screenshot width;
the inspected form, action rows and confirmation card remained readable. This is not
a fixed CSS-viewport measurement or packaged-app/mailbox round-trip acceptance.
No credential, send, permission or task-state action was submitted. The owned test
window and loopback preview server were closed afterward.
