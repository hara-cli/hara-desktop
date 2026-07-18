const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const parseSemanticVersion = (value) => {
  const match = value.trim().match(SEMVER);
  if (!match) return null;

  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    return null;
  }

  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease,
  };
};

const comparePrerelease = (left, right) => {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
};

const compareSemanticVersions = (left, right) => {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] === right.core[index]) continue;
    return left.core[index] < right.core[index] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
};

/**
 * Classifies the engine that answered Desktop's Serve handshake against the
 * engine shipped in this application. Build metadata is intentionally ignored,
 * as required by SemVer.
 */
export function classifyEngineVersion(runningVersion, bundledVersion) {
  if (!runningVersion.trim()) return "unknown";
  const running = parseSemanticVersion(runningVersion);
  const bundled = parseSemanticVersion(bundledVersion);
  if (!running || !bundled) return "incompatible";

  const comparison = compareSemanticVersions(running, bundled);
  if (comparison === 0) return "matching";
  return comparison < 0 ? "older" : "newer";
}
