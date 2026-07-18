import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgePetActivity,
  clearPetActivity,
  selectPetSnapshot,
  setPetActivity,
  type ActivePetStatus,
  type PetActivities,
  type PetCatalogEntry,
} from "../pets";
import {
  DEFAULT_PET_SELECTOR,
  emitPetConfig,
  emitPetState,
  PET_AWAKE_KEY,
  PET_SELECTOR_KEY,
  syncPetWindow,
} from "../pet-runtime";

interface DesktopCompanionOptions {
  getActivityTitle: (sessionId: string) => string;
  onOpenActivity: (sessionId: string) => void | Promise<void>;
}

/**
 * Owns the source-neutral Desktop companion state and window bridge.
 * Agent execution remains in hara serve; callers only project structured session events here.
 */
export function useDesktopCompanion({
  getActivityTitle,
  onOpenActivity,
}: DesktopCompanionOptions) {
  const [awake, setAwake] = useState(() => localStorage.getItem(PET_AWAKE_KEY) === "1");
  const [selector, setSelector] = useState(
    () => localStorage.getItem(PET_SELECTOR_KEY) || DEFAULT_PET_SELECTOR,
  );
  const [activities, setActivities] = useState<PetActivities>({});
  const [catalog, setCatalog] = useState<PetCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState("");

  const selectorRef = useRef(selector);
  const activitiesRef = useRef(activities);
  const titleRef = useRef(getActivityTitle);
  const openActivityRef = useRef(onOpenActivity);
  titleRef.current = getActivityTitle;
  openActivityRef.current = onOpenActivity;

  const note = useCallback((sessionId: string, status: ActivePetStatus) => {
    setActivities((current) =>
      setPetActivity(current, sessionId, status, titleRef.current(sessionId)),
    );
  }, []);

  const acknowledge = useCallback((sessionId: string) => {
    setActivities((current) => acknowledgePetActivity(current, sessionId));
  }, []);

  const clear = useCallback((sessionId: string) => {
    setActivities((current) => clearPetActivity(current, sessionId));
  }, []);

  const refreshCatalog = useCallback(async () => {
    setCatalogError("");
    try {
      setCatalog(await invoke<PetCatalogEntry[]>("list_pets"));
    } catch (error) {
      setCatalog([]);
      setCatalogError(String(error));
    }
  }, []);

  // Register the ready/open/tuck bridge before creating the window so a fast pet boot cannot lose
  // its initial configuration or activity snapshot.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const keep = (unlisten: () => void) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };
    void listen("hara-pet-ready", () => {
      void emitPetConfig({ selector: selectorRef.current }).catch(() => {});
      void emitPetState(selectPetSnapshot(activitiesRef.current)).catch(() => {});
    }).then(keep);
    void listen<{ sessionId?: string }>("hara-pet-open", ({ payload }) => {
      if (payload?.sessionId) void openActivityRef.current(payload.sessionId);
    }).then(keep);
    void listen("hara-pet-tuck", () => setAwake(false)).then(keep);
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(PET_AWAKE_KEY, awake ? "1" : "0");
    void syncPetWindow(awake).catch((error) => setCatalogError(String(error)));
  }, [awake]);

  useEffect(() => {
    localStorage.setItem(PET_SELECTOR_KEY, selector);
    selectorRef.current = selector;
    if (awake) void emitPetConfig({ selector }).catch(() => {});
  }, [awake, selector]);

  useEffect(() => {
    activitiesRef.current = activities;
    if (awake) void emitPetState(selectPetSnapshot(activities)).catch(() => {});
  }, [activities, awake]);

  return {
    awake,
    setAwake,
    selector,
    setSelector,
    catalog,
    catalogError,
    refreshCatalog,
    note,
    acknowledge,
    clear,
  };
}
