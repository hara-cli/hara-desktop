export const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
export const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

export function requireStableVersion(value, label = "version") {
  if (typeof value !== "string" || !STABLE_VERSION_PATTERN.test(value)) {
    throw new Error(`${label} must be a stable X.Y.Z version, got ${value || "<empty>"}`);
  }
  return value;
}

export function requireStableTag(tag, version) {
  requireStableVersion(version, "release version");
  if (tag !== `v${version}`) {
    throw new Error(`release tag must be v${version}, got ${tag || "<empty>"}`);
  }
  return tag;
}

export function requireGitCommit(value, label = "commit") {
  if (typeof value !== "string" || !GIT_COMMIT_PATTERN.test(value)) {
    throw new Error(`${label} must be a full 40-character Git commit, got ${value || "<empty>"}`);
  }
  return value.toLowerCase();
}
