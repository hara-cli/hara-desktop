import type { HaraClient } from "./client";

/** An upgrading Desktop may still attach to an older engine. Retire only its local visible-group
 * scene, never the official owner DM gateway, Agent identity, global policy or saved audit files. */
export async function stopRetiredWechatScene(
  client: Pick<HaraClient, "supports" | "stopWechatGroupScene">,
): Promise<void> {
  if (!client.supports("settings.wechat-group.stop")) return;
  const message = "The retired local WeChat group scene was not confirmed stopped. Update and restart the old Hara engine before continuing.";
  let status;
  try { status = await client.stopWechatGroupScene(); }
  catch { throw new Error(message); }
  if (status?.active !== false || status.managedArmed) {
    throw new Error(message);
  }
}
