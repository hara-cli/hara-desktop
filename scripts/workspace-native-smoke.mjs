// The old packaged credential driver stays disabled before any native or filesystem operation.
import { requirePackagedSyntheticCredentialAdapter } from "./workspace-native-vault.mjs";

requirePackagedSyntheticCredentialAdapter();
