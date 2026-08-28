# Hara Mobile Identity Contract

Status: architecture contract; no mobile application or public broker is claimed by this release.

## Decision

Hara mobile and Hara Desktop use one account identity and separate device identities.

```text
Hara account userId
├─ macOS deviceId + device key
├─ iPhone deviceId + device key
└─ Android deviceId + device key
```

This gives users one Personal/company directory while preserving independent device revocation, audit,
biometric policy, encrypted caches, and notification endpoints. Copying a Mac token or private key to a
phone is forbidden.

## Apple product and bundle identity

The current macOS app already uses the bundle identifier `com.nanhara.hara`. The planned iOS Hara app should
register or reuse the matching explicit App ID and use that same bundle identifier. It is another platform
target of the same Hara product, not a separate “Hara Remote” product. Apple supports one explicit App ID
across iOS and macOS, and an App Store Connect record can add platform-specific builds with the same bundle
ID:

- [Register an App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id)
- [Add platforms](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms)

Sharing the bundle ID does **not** share an installation identity or credential. Each platform has its own
target, provisioning profile, entitlements, build number, push environment, Secure Enclave/Keychain device
key, `deviceId`, refresh-token family, encrypted cache, and revocation record. Platform extensions use their
own suffix identifiers under the same namespace when introduced.

The current macOS build is distributed through Hara's signed direct-update channel and uses desktop-only
runtime entitlements. This contract does not claim a Mac App Store build or universal purchase. If Hara later
ships on the Mac App Store, its sandbox and entitlement review is a separate release gate before adding the
macOS platform to the App Store record. A distinct bundle ID is reserved only for a genuinely independent
future product, not for the planned Hara phone client.

## Pairing

1. The signed-in Desktop requests an expiring, single-use pairing challenge from the account service.
2. Mobile creates a hardware-backed key pair and scans or enters the challenge.
3. Desktop displays the account, device label, requested scopes, and expiry for confirmation.
4. The service binds the mobile public key to the same `userId` and returns a device-scoped credential.
5. Both devices record a redacted audit event. The challenge cannot be replayed.

Device credentials are audience-bound, short-lived where practical, rotated independently, and never grant
provider access. Losing or revoking one device leaves other device sessions intact.

## Published resources

Local Hara/Codex/Claude sessions are not account data by default. Desktop must create a bounded publication:

```text
publicationId
ownerUserId
sourceDeviceId
resourceOpaqueId
audienceDeviceIds[]
capabilities: read | submit | approve
leaseEpoch
expiresAt
revokedAt?
organizationGrant?
```

The broker sees only routing metadata and encrypted envelopes. The source Desktop/Core remains the execution
authority and validates every device signature, capability, expiry, command id, and lease epoch.

## Company boundary

Account login does not imply organization access. Every company request also resolves an active membership,
role, policy revision, and resource grant. A Personal session remains Personal when the user switches company.
Publishing it to a company is an explicit action that can be disallowed by company policy and revoked by the
owner or an authorized administrator.

## Release prerequisites for a real mobile client

- production account and organization authorization services;
- outbound-only Desktop relay with end-to-end encrypted payloads;
- one-time pairing, per-device revoke/rotate, and audit export;
- durable snapshot plus ordered replay with idempotent commands and lease epochs;
- push-notification privacy rules and encrypted local cache deletion;
- lost-device, offline, provider-exit, stale-approval, and cross-company penetration tests.

Until all prerequisites pass, Desktop keeps external sessions local and Personal-only.
