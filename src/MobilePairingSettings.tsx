import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  HaraClient,
  MobileCompanionStatus,
  MobilePairingInvitation,
  MobilePairingSnapshot,
} from "./client";
import {
  SettingsBadge,
  SettingsCard,
  SettingsItem,
  SettingsNotice,
} from "./SettingsUI";
import "./MobilePairingSettings.css";

type Props = {
  client: HaraClient | null;
  locale: "en" | "zh";
};

const COPY = {
  en: {
    account: "Hara account",
    accountMissing: "Desktop account sign-in required",
    accountMissingBody:
      "This Desktop has not joined your Hara account yet. Pairing stays unavailable until Desktop sign-in is complete.",
    accountSetup: "If Hara CLI is installed, run this once in Terminal, then refresh the status:",
    accountReady: "Account ready",
    accountChecking: "Checking Desktop account…",
    approve: "Allow this phone",
    approved: "Phone paired",
    approvedBody:
      "This phone identity is now paired. Only separately published Sessions appear when remote service is available; model keys and local paths remain on this computer.",
    cancelled: "This invitation is no longer active.",
    code: "Manual code",
    copied: "Copied",
    copy: "Copy",
    create: "Create pairing QR",
    creating: "Creating…",
    description:
      "Create a two-minute, single-use invitation. Scan it in Hara Mobile, review on the phone, then confirm the exact device here.",
    device: "Phone requesting access",
    expires: "Expires in {{seconds}}s",
    expired: "Invitation expired",
    fingerprint: "Device key · {{suffix}}",
    instructions:
      "Open Hara Mobile → Pair your computer → Scan QR. If the camera is unavailable, enter the manual code.",
    pending: "Waiting for the phone to scan",
    qrAlt: "Short-lived Hara Mobile pairing QR code",
    refresh: "Refresh status",
    reject: "Reject",
    rejected: "Pairing rejected",
    safety: "Two-device confirmation",
    safetyBody:
      "The QR contains only a region, expiry, and one-time invitation. It never contains an account token, device private key, or model credential.",
    status: "Paired phones",
    title: "Mobile pairing",
    unsupported: "Update the Hara engine to use secure QR pairing.",
  },
  zh: {
    account: "Hara 账号",
    accountMissing: "需要先完成 Desktop 账号登录",
    accountMissingBody:
      "这台 Desktop 还没有加入你的 Hara 账号；账号登录完成前不会开放手机配对。",
    accountSetup: "如已安装 Hara CLI，可先在终端运行一次，再刷新状态：",
    accountReady: "账号已就绪",
    accountChecking: "正在读取 Desktop 账号状态…",
    approve: "允许这台手机",
    approved: "手机已配对",
    approvedBody:
      "这台手机的设备身份已完成配对；只有另行明确发布且远程服务可用的会话才会出现，模型密钥和本地路径仍留在这台电脑。",
    cancelled: "这份邀请已经失效。",
    code: "手动配对码",
    copied: "已复制",
    copy: "复制",
    create: "生成配对二维码",
    creating: "正在生成…",
    description:
      "生成一份两分钟有效、只能使用一次的邀请。用 Hara Mobile 扫码并核对，再在这里确认准确的手机设备。",
    device: "正在申请的手机",
    expires: "{{seconds}} 秒后过期",
    expired: "邀请已过期",
    fingerprint: "设备密钥 · {{suffix}}",
    instructions:
      "打开 Hara Mobile → 配对你的电脑 → 扫描二维码。相机不可用时，可输入下方配对码。",
    pending: "等待手机扫码",
    qrAlt: "短时有效的 Hara 手机配对二维码",
    refresh: "刷新状态",
    reject: "拒绝",
    rejected: "已拒绝配对",
    safety: "双端确认",
    safetyBody:
      "二维码只包含区域、过期时间和一次性邀请，不包含账号 Token、设备私钥或模型密钥。",
    status: "已配对手机",
    title: "手机配对",
    unsupported: "请更新 Hara 引擎后使用安全二维码配对。",
  },
} as const;

const TERMINAL_PAIRING_STATES: ReadonlySet<MobilePairingSnapshot["state"]> = new Set([
  "approved",
  "rejected",
  "consumed",
  "expired",
  "cancelled",
]);

function replaceSeconds(template: string, seconds: number): string {
  return template.replace("{{seconds}}", String(seconds));
}

function safeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 240);
}

function validInvitation(value: MobilePairingInvitation): boolean {
  const expectedPayload = `hara://pair?v=1&region=${value.accountRegion}&code=${value.pairingCode}&expires=${Math.floor(value.expiresAt / 1_000)}`;
  return value.protocolVersion === 1
    && (value.accountRegion === "cn" || value.accountRegion === "global")
    && /^[A-Za-z0-9._~-]{1,160}$/u.test(value.challengeId)
    && /^HARA_[A-Za-z0-9_-]{11,123}$/u.test(value.pairingCode)
    && value.qrPayload === expectedPayload
    && Number.isSafeInteger(value.expiresAt)
    && value.expiresAt > Date.now()
    && value.state === "pending";
}

export function MobilePairingSettings({ client, locale }: Props) {
  const copy = COPY[locale];
  const [account, setAccount] = useState<MobileCompanionStatus | null>(null);
  const [accountChecked, setAccountChecked] = useState(false);
  const [invitation, setInvitation] = useState<MobilePairingInvitation | null>(null);
  const [pairing, setPairing] = useState<MobilePairingSnapshot | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState<"create" | "approve" | "reject" | "">("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const accountRequestRef = useRef(0);
  const currentClientRef = useRef(client);
  currentClientRef.current = client;
  const supported = Boolean(
    client
    && client.supports("mobile.status")
    && client.supports("mobile.pairing.create")
    && client.supports("mobile.pairing.status")
    && client.supports("mobile.pairing.decide"),
  );

  const refreshAccount = useCallback(async () => {
    if (!client || !supported || currentClientRef.current !== client) return;
    const requestId = ++accountRequestRef.current;
    setAccountChecked(false);
    setError("");
    try {
      const next = await client.mobileCompanionStatus();
      if (accountRequestRef.current === requestId && currentClientRef.current === client) setAccount(next);
    } catch (reason) {
      if (accountRequestRef.current === requestId && currentClientRef.current === client) {
        setError(safeError(reason));
      }
    } finally {
      if (accountRequestRef.current === requestId && currentClientRef.current === client) {
        setAccountChecked(true);
      }
    }
  }, [client, supported]);

  useEffect(() => {
    setAccount(null);
    setAccountChecked(false);
    setInvitation(null);
    setPairing(null);
    setQrDataUrl("");
    setBusy("");
    setCopied(false);
    setError("");
    void refreshAccount();
    return () => {
      accountRequestRef.current += 1;
    };
  }, [refreshAccount]);

  useEffect(() => {
    if (!invitation) return;
    let disposed = false;
    void import("qrcode")
      .then((module) => module.toDataURL(invitation.qrPayload, {
        color: { dark: "#28231F", light: "#FFFDF8" },
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320,
      }))
      .then((url) => {
        if (!disposed) setQrDataUrl(url);
      })
      .catch((reason) => {
        if (!disposed) setError(safeError(reason));
      });
    return () => {
      disposed = true;
    };
  }, [invitation]);

  const challengeId = invitation?.challengeId ?? "";
  const expiresAt = invitation?.expiresAt ?? 0;
  const pairingTerminal = pairing ? TERMINAL_PAIRING_STATES.has(pairing.state) : false;

  useEffect(() => {
    if (!client || !challengeId || expiresAt <= 0 || pairingTerminal) return;
    let disposed = false;
    let timer: number | null = null;
    const tick = async () => {
      const observedAt = Date.now();
      if (!disposed) setNow(observedAt);
      if (observedAt >= expiresAt) return;
      try {
        const next = await client.inspectMobilePairing(challengeId);
        if (!disposed && currentClientRef.current === client) setPairing(next);
      } catch (reason) {
        if (!disposed && currentClientRef.current === client && Date.now() < expiresAt) {
          setError(safeError(reason));
        }
      } finally {
        if (!disposed && currentClientRef.current === client && Date.now() < expiresAt) {
          timer = window.setTimeout(() => void tick(), 1_000);
        }
      }
    };
    void tick();
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [challengeId, client, expiresAt, pairingTerminal]);

  const secondsLeft = invitation
    ? Math.max(0, Math.ceil((invitation.expiresAt - now) / 1_000))
    : 0;
  const currentState = pairing?.state ?? invitation?.state;
  const invitationActive = Boolean(invitation && secondsLeft > 0 && (
    currentState === "pending" || currentState === "claimed"
  ));
  const keySuffix = pairing?.mobile?.publicKeyThumbprint.slice(-8).toUpperCase() ?? "";

  const createPairing = async () => {
    if (!client || busy) return;
    const pairingClient = client;
    setBusy("create");
    setError("");
    setCopied(false);
    setInvitation(null);
    setPairing(null);
    setQrDataUrl("");
    try {
      const created = await pairingClient.createMobilePairing();
      if (currentClientRef.current !== pairingClient) return;
      if (!validInvitation(created)) throw new Error("Hara returned an invalid pairing invitation");
      setNow(Date.now());
      setInvitation(created);
    } catch (reason) {
      if (currentClientRef.current === pairingClient) setError(safeError(reason));
    } finally {
      if (currentClientRef.current === pairingClient) setBusy("");
    }
  };

  const decide = async (approved: boolean) => {
    if (
      !client
      || !invitation
      || !pairing?.mobile
      || pairing.state !== "claimed"
      || invitation.expiresAt <= Date.now()
      || busy
    ) return;
    const pairingClient = client;
    setBusy(approved ? "approve" : "reject");
    setError("");
    try {
      const decided = await pairingClient.decideMobilePairing(invitation.challengeId, approved);
      if (currentClientRef.current !== pairingClient) return;
      setPairing(decided);
      await refreshAccount();
    } catch (reason) {
      if (currentClientRef.current === pairingClient) setError(safeError(reason));
    } finally {
      if (currentClientRef.current === pairingClient) setBusy("");
    }
  };

  const copyCode = async () => {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.pairingCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch (reason) {
      setError(safeError(reason));
    }
  };

  const accountBadge = useMemo(() => {
    if (!account?.signedIn) return null;
    return (
      <SettingsBadge tone={account.accountSession === "active" ? "success" : "warning"}>
        {account.account?.displayName ?? copy.accountReady}
      </SettingsBadge>
    );
  }, [account, copy.accountReady]);

  if (!supported) {
    return <SettingsNotice tone="warning" title={copy.title}>{copy.unsupported}</SettingsNotice>;
  }

  return (
    <>
      <SettingsCard title={copy.title} description={copy.description} aside={accountBadge}>
        <SettingsItem
          title={copy.account}
          description={accountChecked
            ? account?.account?.displayName ?? copy.accountMissingBody
            : copy.accountChecking}
        >
          <SettingsBadge tone={!accountChecked ? "neutral" : account?.signedIn ? "success" : "warning"}>
            {!accountChecked
              ? copy.accountChecking
              : account?.signedIn ? copy.accountReady : copy.accountMissing}
          </SettingsBadge>
        </SettingsItem>
        <SettingsItem title={copy.status}>
          <span className="settings-mono">{account?.pairedMobileDevices ?? 0}</span>
        </SettingsItem>

        {!accountChecked ? null : !account?.signedIn ? (
          <SettingsNotice
            tone="warning"
            title={copy.accountMissing}
            actions={(
              <button type="button" className="ghost" onClick={() => void refreshAccount()}>
                {copy.refresh}
              </button>
            )}
          >
            <span>
              {copy.accountMissingBody} {copy.accountSetup}{" "}
              <code className="settings-mono">hara mobile login</code>
            </span>
          </SettingsNotice>
        ) : (
          <div className="mobile-pairing-action-row">
            <button type="button" onClick={() => void createPairing()} disabled={Boolean(busy)}>
              {busy === "create" ? copy.creating : copy.create}
            </button>
          </div>
        )}

        {error ? <SettingsNotice tone="error" title={copy.title}>{error}</SettingsNotice> : null}

        {invitation ? (
          <div className="mobile-pairing-ritual" aria-live="polite">
            <div className="mobile-pairing-qr-panel">
              <div className="mobile-pairing-qr-frame">
                {qrDataUrl ? <img src={qrDataUrl} alt={copy.qrAlt} /> : <span aria-hidden />}
              </div>
              <strong>
                {secondsLeft > 0
                  ? replaceSeconds(copy.expires, secondsLeft)
                  : copy.expired}
              </strong>
              <small>{copy.instructions}</small>
            </div>

            <div className="mobile-pairing-review-panel">
              <div className="mobile-pairing-code-label">{copy.code}</div>
              <div className="mobile-pairing-code-row">
                <code>{invitation.pairingCode}</code>
                <button type="button" className="ghost" onClick={() => void copyCode()}>
                  {copied ? copy.copied : copy.copy}
                </button>
              </div>

              {pairing?.mobile && pairing.state === "claimed" && invitationActive ? (
                <div className="mobile-pairing-device-review">
                  <div className="mobile-pairing-device-mark" aria-hidden>PH</div>
                  <div>
                    <small>{copy.device}</small>
                    <strong>{pairing.mobile.label}</strong>
                    <span>
                      {pairing.mobile.platform.toUpperCase()} · {copy.fingerprint.replace("{{suffix}}", keySuffix)}
                    </span>
                  </div>
                  <div className="mobile-pairing-review-actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled={Boolean(busy)}
                      onClick={() => void decide(false)}
                    >
                      {copy.reject}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void decide(true)}
                    >
                      {copy.approve}
                    </button>
                  </div>
                </div>
              ) : pairing?.state === "approved" || pairing?.state === "consumed" ? (
                <SettingsNotice tone="success" title={copy.approved}>{copy.approvedBody}</SettingsNotice>
              ) : pairing?.state === "rejected" ? (
                <SettingsNotice tone="neutral" title={copy.rejected} />
              ) : !invitationActive ? (
                <SettingsNotice tone="warning" title={copy.expired}>{copy.cancelled}</SettingsNotice>
              ) : (
                <div className="mobile-pairing-waiting">
                  <span aria-hidden />
                  {copy.pending}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </SettingsCard>

      <SettingsNotice tone="neutral" title={copy.safety}>{copy.safetyBody}</SettingsNotice>
    </>
  );
}
