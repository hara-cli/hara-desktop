import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgePetActivity,
  clearPetActivity,
  selectPetSnapshot,
  setPetActivity,
  type ActivePetStatus,
  type PetActivities,
  type PetCatalogEntry,
  type PetChatApproval,
  type PetChatResult,
  type PetChatState,
  type PetChatSubmit,
  type PetStatus,
} from "../pets";
import {
  DEFAULT_PET_SELECTOR,
  emitPetChatState,
  emitPetConfig,
  emitPetState,
  PET_AWAKE_KEY,
  PET_SELECTOR_KEY,
  syncPetChatWindow,
  syncPetWindow,
} from "../pet-runtime";

interface DesktopCompanionOptions {
  getActivityTitle: (sessionId: string) => string;
  onOpenActivity: (sessionId: string) => void | Promise<void>;
  resolveChatSession: (requestedSessionId?: string) => string | undefined;
  getChatState: (sessionId: string | undefined, petStatus: PetStatus) => PetChatState;
  onChatSubmit: (request: PetChatSubmit) => Promise<string | undefined>;
  onChatApproval: (request: PetChatApproval) => Promise<void>;
}

/**
 * Owns the source-neutral Desktop companion state and window bridge.
 * Agent execution remains in hara serve; callers only project structured session events here.
 */
export function useDesktopCompanion({
  getActivityTitle,
  onOpenActivity,
  resolveChatSession,
  getChatState,
  onChatSubmit,
  onChatApproval,
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
  const resolveChatSessionRef = useRef(resolveChatSession);
  const chatStateRef = useRef(getChatState);
  const chatSubmitRef = useRef(onChatSubmit);
  const chatApprovalRef = useRef(onChatApproval);
  const chatSessionRef = useRef<string | undefined>(undefined);
  const chatGenerationRef = useRef(0);
  const chatOpenRef = useRef(false);
  const chatRefreshTimerRef = useRef<number | null>(null);
  titleRef.current = getActivityTitle;
  openActivityRef.current = onOpenActivity;
  resolveChatSessionRef.current = resolveChatSession;
  chatStateRef.current = getChatState;
  chatSubmitRef.current = onChatSubmit;
  chatApprovalRef.current = onChatApproval;

  const note = useCallback((sessionId: string, status: ActivePetStatus, title?: string) => {
    setActivities((current) =>
      setPetActivity(current, sessionId, status, title || titleRef.current(sessionId)),
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

  const emitChatState = useCallback(() => {
    if (!chatOpenRef.current) return;
    const sessionId = chatSessionRef.current;
    const petStatus = sessionId
      ? activitiesRef.current[sessionId]?.status ?? "idle"
      : "idle";
    void emitPetChatState(chatStateRef.current(sessionId, petStatus)).catch(() => {});
  }, []);

  /** Keep transcript streaming off the native IPC hot path while the chat is hidden, and collapse
   *  visible-window token bursts into one state projection per short frame. */
  const refreshChat = useCallback((immediate = false) => {
    if (!chatOpenRef.current) return;
    if (immediate) {
      if (chatRefreshTimerRef.current !== null) {
        window.clearTimeout(chatRefreshTimerRef.current);
        chatRefreshTimerRef.current = null;
      }
      emitChatState();
      return;
    }
    if (chatRefreshTimerRef.current !== null) return;
    chatRefreshTimerRef.current = window.setTimeout(() => {
      chatRefreshTimerRef.current = null;
      emitChatState();
    }, 50);
  }, [emitChatState]);

  const closeChatProjection = useCallback(() => {
    chatOpenRef.current = false;
    chatGenerationRef.current += 1;
    chatSessionRef.current = undefined;
    if (chatRefreshTimerRef.current !== null) {
      window.clearTimeout(chatRefreshTimerRef.current);
      chatRefreshTimerRef.current = null;
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
    void listen<{ sessionId?: string }>("hara-pet-chat-open", ({ payload }) => {
      // Resolve once for the lifetime of this chat window. Later task activity and main-window
      // navigation must never redirect an in-progress draft to a different session or cwd.
      chatGenerationRef.current += 1;
      const generation = chatGenerationRef.current;
      chatOpenRef.current = true;
      chatSessionRef.current = resolveChatSessionRef.current(payload?.sessionId);
      void syncPetChatWindow(true)
        .then(() => refreshChat(true))
        .catch(() => {
          if (generation === chatGenerationRef.current) closeChatProjection();
        });
    }).then(keep);
    void listen("hara-pet-chat-ready", () => refreshChat(true)).then(keep);
    void listen<PetChatSubmit>("hara-pet-chat-submit", ({ payload }) => {
      void (async () => {
        const generation = chatGenerationRef.current;
        const pinnedSessionId = chatSessionRef.current;
        let result: PetChatResult;
        try {
          if (payload.sessionId !== pinnedSessionId) {
            throw new Error("The companion target changed. Review the current conversation and send again.");
          }
          const sessionId = await chatSubmitRef.current({
            ...payload,
            ...(pinnedSessionId ? { sessionId: pinnedSessionId } : { sessionId: undefined }),
          });
          if (
            sessionId
            && generation === chatGenerationRef.current
            && chatSessionRef.current === pinnedSessionId
          ) {
            chatSessionRef.current = sessionId;
          }
          result = { requestId: payload.requestId, ok: true, ...(sessionId ? { sessionId } : {}) };
        } catch (error) {
          result = { requestId: payload.requestId, ok: false, error: String(error) };
        }
        await emitTo("pet-chat", "hara-pet-chat-result", result).catch(() => {});
        if (generation === chatGenerationRef.current) refreshChat(true);
      })();
    }).then(keep);
    void listen<PetChatApproval>("hara-pet-chat-approval", ({ payload }) => {
      void (async () => {
        const generation = chatGenerationRef.current;
        const pinnedSessionId = chatSessionRef.current;
        let result: PetChatResult;
        try {
          if (!pinnedSessionId || payload.sessionId !== pinnedSessionId) {
            throw new Error("The companion target changed. Reopen the approval before responding.");
          }
          await chatApprovalRef.current({ ...payload, sessionId: pinnedSessionId });
          result = { requestId: payload.requestId, ok: true, sessionId: pinnedSessionId };
        } catch (error) {
          result = { requestId: payload.requestId, ok: false, error: String(error) };
        }
        await emitTo("pet-chat", "hara-pet-chat-result", result).catch(() => {});
        if (generation === chatGenerationRef.current) refreshChat(true);
      })();
    }).then(keep);
    void listen("hara-pet-chat-close", () => {
      closeChatProjection();
      void syncPetChatWindow(false).catch(() => {});
    }).then(keep);
    void listen("hara-pet-chat-open-main", () => {
      void (async () => {
        const pinnedSessionId = chatSessionRef.current;
        closeChatProjection();
        if (pinnedSessionId) await openActivityRef.current(pinnedSessionId);
        const main = await WebviewWindow.getByLabel("main");
        await main?.show();
        await main?.setFocus();
        await syncPetChatWindow(false);
      })().catch(() => {});
    }).then(keep);
    return () => {
      disposed = true;
      closeChatProjection();
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [closeChatProjection, refreshChat]);

  useEffect(() => {
    localStorage.setItem(PET_AWAKE_KEY, awake ? "1" : "0");
    void syncPetWindow(awake).catch((error) => setCatalogError(String(error)));
    if (!awake) {
      closeChatProjection();
      void syncPetChatWindow(false).catch(() => {});
    }
  }, [awake, closeChatProjection]);

  useEffect(() => {
    localStorage.setItem(PET_SELECTOR_KEY, selector);
    selectorRef.current = selector;
    if (awake) void emitPetConfig({ selector }).catch(() => {});
  }, [awake, selector]);

  useEffect(() => {
    activitiesRef.current = activities;
    if (awake) {
      void emitPetState(selectPetSnapshot(activities)).catch(() => {});
      refreshChat();
    }
  }, [activities, awake, refreshChat]);

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
    refreshChat,
  };
}
