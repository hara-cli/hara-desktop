import { useState } from "react";
import "./EmbeddedBrowserSurface.css";

interface EmbeddedBrowserSurfaceProps {
  title: string;
  artifactId: string;
  revisionId: string;
  html: string;
  copy: {
    browser: string;
    local: string;
    reload: string;
  };
}

const shortId = (value: string): string => value.slice(-8).toUpperCase();

export default function EmbeddedBrowserSurface({
  title,
  artifactId,
  revisionId,
  html,
  copy,
}: EmbeddedBrowserSurfaceProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const address = `hara://presentation/${shortId(artifactId)}/${shortId(revisionId)}`;

  return (
    <section className="embedded-browser" aria-label={`${copy.browser}: ${title}`}>
      <header className="embedded-browser-chrome">
        <div className="embedded-browser-traffic" aria-hidden>
          <i /><i /><i />
        </div>
        <div className="embedded-browser-navigation">
          <button type="button" disabled aria-label="Back">‹</button>
          <button type="button" disabled aria-label="Forward">›</button>
          <button type="button" aria-label={copy.reload} title={copy.reload} onClick={() => setReloadKey((key) => key + 1)}>↻</button>
        </div>
        <div className="embedded-browser-address" title={address}>
          <span aria-hidden>◇</span>
          <code>{address}</code>
        </div>
        <span className="embedded-browser-local">{copy.local}</span>
      </header>
      <iframe
        key={`${revisionId}:${reloadKey}`}
        srcDoc={html}
        title={title}
        sandbox="allow-scripts allow-modals allow-downloads"
        allow="fullscreen"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
    </section>
  );
}
