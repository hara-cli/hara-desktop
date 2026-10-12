import { useState } from "react";
import type { BusIdentity, BusMember } from "./client";
import { SettingsBadge, SettingsCard, SettingsNotice } from "./SettingsUI";

export function DeskUsersPanel({ users, identity, zh, disabled, save, agentName }: {
  users: BusMember[]; identity: BusIdentity | null; zh: boolean; disabled: boolean;
  save: (input: Record<string, unknown>) => Promise<boolean>; agentName: (id: string) => string;
}) {
  const [editing, setEditing] = useState<BusMember | null>(null);
  const l = (cn: string, en: string) => zh ? cn : en;
  return <SettingsCard title={identity?.admin ? l("用户管理", "User management") : l("我的 Agent", "My Agents")}
    description={l("一个用户可拥有多个 Agent，项目权限可授予用户或指定 Agent。", "Each user can have multiple Agents. Grant project access to a user or a specific Agent.")}>
    {users.map(user => <article className="mailbox-connection" key={user.id}>
      <div><strong>{user.name}</strong> <SettingsBadge>{user.role}</SettingsBadge><p>{user.state} · {user.agentIds.map(agentName).join(" / ")}</p></div>
      {identity?.admin && user.id !== identity.memberId && user.role !== "owner" && <button className="compact" disabled={disabled} onClick={() => setEditing({ ...user })}>{l("管理", "Manage")}</button>}
    </article>)}
    {editing && <form className="mailbox-project-form" onSubmit={e => { e.preventDefault(); void save({ memberId: editing.id, name: editing.name, role: editing.role, state: editing.state, expectedRevision: editing.revision }).then(saved => { if (saved) setEditing(null); }); }}>
      <label>{l("显示名称", "Display name")}<input required maxLength={120} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} disabled={disabled} /></label>
      <div className="mailbox-form-row"><label>{l("角色", "Role")}<select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })} disabled={disabled}>
        <option value="viewer">{l("访客", "Viewer")}</option><option value="member">{l("成员", "Member")}</option><option value="admin">{l("管理员", "Administrator")}</option>
      </select></label><label>{l("状态", "State")}<select value={editing.state} onChange={e => setEditing({ ...editing, state: e.target.value })} disabled={disabled}>
        <option value="active">{l("启用", "Active")}</option><option value="suspended">{l("停用", "Suspended")}</option>
      </select></label></div>
      <SettingsNotice title={l("停用会结束该用户的运行会话", "Suspending ends this user’s runtime sessions")}>{l("历史任务和结果保留。只有组织 owner 可以管理管理员角色。", "Historical work is retained. Only the organization owner can manage administrator roles.")}</SettingsNotice>
      <div className="mailbox-actions"><button type="submit" disabled={disabled}>{l("保存用户", "Save user")}</button><button type="button" className="compact" onClick={() => setEditing(null)}>{l("取消", "Cancel")}</button></div>
    </form>}
    <p className="mailbox-muted">{l("新增用户沿用 Hara 公司邀请和加入流程；此处不另建登录账号。", "New users join through Hara’s existing company invitation flow.")}</p>
  </SettingsCard>;
}
