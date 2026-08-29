import React, { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./renderer-recovery.css";

declare global {
  interface Window {
    __HARA_RENDERER_STATE__?: "booting" | "ready" | "recovery";
  }
}

function markRendererState(state: "ready" | "recovery") {
  window.__HARA_RENDERER_STATE__ = state;
  document.documentElement.dataset.haraRenderer = state;
  window.dispatchEvent(new Event(state === "ready" ? "hara-renderer-ready" : "hara-renderer-recovery"));
}

export function RendererBootSignal({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    markRendererState("ready");
    // A native boot watchdog uses this bounded signal on Windows to distinguish
    // a healthy renderer from a WebView2/GPU process that never executed JS.
    void invoke("renderer_ready").catch(() => {});
  }, []);
  return children;
}

type RendererErrorBoundaryState = { failed: boolean };

export class RendererErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch() {
    // Raw exceptions can contain local paths or provider payload fragments. Keep
    // the recovery surface intentionally generic and never render the stack.
    markRendererState("recovery");
    void invoke("renderer_ready").catch(() => {});
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const zh = navigator.language.toLowerCase().startsWith("zh");
    return (
      <main className="renderer-recovery" role="alert">
        <section className="renderer-recovery-card">
          <div className="renderer-recovery-mark" aria-hidden="true">H</div>
          <p className="renderer-recovery-kicker">HARA · DESKTOP</p>
          <h1>{zh ? "界面没有正常启动" : "The interface did not start"}</h1>
          <p>
            {zh
              ? "你的会话、项目和模型密钥没有被删除。请重新加载界面；Hara 会继续连接原来的本地引擎。"
              : "Your sessions, projects, and model keys were not deleted. Reload the interface to reconnect to the same local engine."}
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            {zh ? "重新加载 Hara" : "Reload Hara"}
          </button>
        </section>
      </main>
    );
  }
}
