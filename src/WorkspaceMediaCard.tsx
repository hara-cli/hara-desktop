import { ArrowDownTrayIcon, FolderIcon, ArrowsPointingOutIcon, PhotoIcon, ShieldCheckIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { PlayIcon } from "@heroicons/react/24/solid";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { redesignText } from "./desktop-redesign-copy";
import { workspaceMediaUrl, revealWorkspaceMedia, type WorkspaceMediaAccess, type WorkspaceMediaDescription, type WorkspaceMediaFailureReason } from "./workspace-media";
type MediaState = "loading" | "content" | "ready" | "failed" | "missing" | "outside";
const filename = (path: string) => { try { return decodeURIComponent(path.split(/[\\/]/u).pop() ?? path).replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 160); } catch { return ""; } };
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function WorkspaceMediaCard({ source, alt, kind, media, scope, locale, load }: {
  source: string; alt: string; kind: "image" | "video" | "file"; media?: WorkspaceMediaAccess; scope: string; locale: string;
  load(path: string, refresh: boolean): Promise<WorkspaceMediaDescription>;
}) {
  const [path, setPath] = useState(source), [state, setState] = useState<MediaState>("loading"), [descriptor, setDescriptor] = useState<Extract<WorkspaceMediaDescription, { state: "ready" }> | null>(null);
  const [failureReason, setFailureReason] = useState<WorkspaceMediaFailureReason | undefined>();
  const [revision, setRevision] = useState(0), [lightbox, setLightbox] = useState(false), [seconds, setSeconds] = useState<number | null>(null), [playing, setPlaying] = useState(false), [actionNotice, setActionNotice] = useState("");
  const image = useRef<HTMLImageElement>(null), video = useRef<HTMLVideoElement>(null), dialog = useRef<HTMLDialogElement>(null), zoom = useRef<HTMLButtonElement>(null), alive = useRef(true);
  const r = (key: Parameters<typeof redesignText>[1], values: Record<string, string | number> = {}) => redesignText(locale, key, values);
  const current = () => alive.current && (!media || media.mediaScope === scope);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; setState("loading"); setFailureReason(undefined); setDescriptor(null); setActionNotice(""); setSeconds(null); setPlaying(false);
    void load(path, revision > 0).then(result => { if (cancelled || !current()) return;
      if (result.state === "ready") { setDescriptor(result); setState(/^(image|video)\//u.test(result.media.mime) ? "content" : "ready"); } else { setState(result.state); setFailureReason(result.state === "failed" ? result.reason : undefined); }
    }, () => { if (!cancelled && current()) setState("failed"); });
    return () => { cancelled = true; const node = video.current; if (node) { node.pause(); node.removeAttribute("src"); node.load(); } };
  }, [path, revision, scope, load]);
  useEffect(() => {
    if (!lightbox) return;
    const node = dialog.current; if (!node) return; node.showModal(); node.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { node.close(); if (zoom.current?.isConnected) zoom.current.focus({ preventScroll: true }); };
  }, [lightbox]);
  const act = async (action: () => Promise<unknown>) => { if (!current()) return; setActionNotice(""); try { await action(); }
    catch { if (current()) setActionNotice(r(isFile ? "fileFailed" : isVideo ? "videoFailed" : "mediaFailed")); } };
  const reveal = () => descriptor ? act(() => revealWorkspaceMedia(descriptor.media.id)) : Promise.resolve();
  const download = () => descriptor ? act(() => invoke("workspace_media_download", { id: descriptor.media.id })) : Promise.resolve();
  const copy = () => act(async () => {
    const node = image.current; if (!node?.naturalWidth || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Copy unavailable");
    if (node.naturalWidth * node.naturalHeight > 16777216) throw new Error("Copy image too large");
    const pending = new Promise<Blob>((resolve, reject) => { const canvas = document.createElement("canvas"); canvas.width = node.naturalWidth; canvas.height = node.naturalHeight;
      const context = canvas.getContext("2d"); if (!context) { reject(new Error("Copy unavailable")); return; }
      context.drawImage(node, 0, 0); canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Copy unavailable")), "image/png"); });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pending })]); if (current()) setActionNotice(r("copied"));
  });
  const locate = () => act(async () => {
    const picked = await open({ multiple: false, directory: false, filters: [{ name: r("locate"), extensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "m4v", "mov", "webm", "pdf", "zip", "xlsx", "md", "txt"] }] });
    if (typeof picked === "string" && current()) { setPath(picked); setRevision(value => value + 1); }
  });
  const ready = state === "ready", isVideo = descriptor ? descriptor.media.mime.startsWith("video/") : kind === "video", name = filename(path);
  const isFile = descriptor ? !/^(image|video)\//u.test(descriptor.media.mime) : kind === "file";
  const loading = state === "loading" || state === "content", failed = !loading && !ready;
  if (isFile && ready && descriptor) return <span className="hd-media-card hd-file-card" role="group" aria-label={alt || name} data-media-state="ready" onClick={event => { event.preventDefault(); event.stopPropagation(); }}>
    <span className={`hd-file-type type-${name.split(".").pop()?.toLowerCase()}`}>{name.split(".").pop()?.toUpperCase()}</span><span className="hd-file-meta"><strong>{name}</strong><small>{size(descriptor.media.bytes)}</small></span><span className="hd-file-actions"><button type="button" onClick={() => void act(() => invoke("workspace_file_open", { id: descriptor.media.id }))}>{r("open")}</button><button type="button" aria-label={r("reveal")} onClick={() => void reveal()}><FolderIcon className="hico" /></button></span>{actionNotice ? <small role="status">{actionNotice}</small> : null}</span>;
  return <span className={`hd-media-card${isVideo ? " is-video" : ""}${isFile ? " is-file" : ""}`} role="group" aria-label={alt || name} data-media-state={state} onClick={event => { if (!(event.target instanceof HTMLVideoElement)) event.preventDefault(); event.stopPropagation(); }}>
    <span className={`hd-media-preview${loading ? " is-loading" : ""}${failed ? " is-failed" : ""}`}>
      {loading ? <span className="hd-media-skeleton" role="status" aria-label={r("loading")} /> : null}
      {descriptor && !failed ? isVideo ? <video key={descriptor.media.id} ref={video} className="md-media-content" playsInline preload="metadata" controls={playing} src={workspaceMediaUrl(descriptor.media.id)} style={{ visibility: ready ? "visible" : "hidden" }}
        onLoadedMetadata={event => { if (!current()) return; const value = event.currentTarget.duration; setSeconds(Number.isFinite(value) ? value : null); setState("ready"); }} onPlay={() => setPlaying(true)} onError={() => { if (current()) setState("failed"); }} />
        : <img key={descriptor.media.id} ref={image} crossOrigin="anonymous" className="md-media-content" alt={alt} onClick={() => setLightbox(true)} src={workspaceMediaUrl(descriptor.media.id)} style={{ visibility: ready ? "visible" : "hidden" }} onLoad={() => { if (current()) setState("ready"); }} onError={() => { if (current()) setState("failed"); }} /> : null}
      {ready && descriptor?.media.mime === "image/gif" ? <span className="hd-gif-label">GIF</span> : null}
      {ready && !isVideo ? <button type="button" ref={zoom} className="hd-media-zoom" aria-label={r("zoom")} onClick={() => setLightbox(true)}><ArrowsPointingOutIcon className="hico" /></button> : null}
      {ready && isVideo && !playing ? <button type="button" className="hd-media-play" aria-label={r("play")} onClick={() => void act(() => video.current?.play() ?? Promise.resolve())}><PlayIcon className="hico" /></button> : null}
      {ready && isVideo && !playing && seconds !== null ? <span className="hd-video-duration">{duration(seconds)}</span> : null}
      {failed ? <span className="hd-media-failure" role="status"><span aria-hidden="true">{state === "outside" ? <ShieldCheckIcon className="hico" /> : state === "failed" ? <ExclamationTriangleIcon className="hico" /> : <PhotoIcon className="hico" />}</span><strong>{r(state === "outside" ? "outside" : state === "missing" ? "moved" : failureReason === "symlink" ? "mediaSymlink" : failureReason === "path_spelling" ? "mediaSpelling" : isFile ? "fileFailed" : isVideo ? "videoFailed" : "mediaFailed")}</strong>
        {state === "missing" ? <small>{r("originalLocation", { path })}</small> : null}
        <span className="hd-media-failure-actions">{state === "missing" || failureReason ? <button type="button" onClick={() => void locate()}>{r("locate")}</button> : state !== "outside" ? <button type="button" onClick={() => setRevision(value => value + 1)}>{r("retry")}</button> : null}<button type="button" disabled={!descriptor || state === "outside" || state === "missing"} onClick={() => void reveal()}>{r("reveal")}</button></span>
      </span> : null}
    </span>
    <span className="hd-media-caption"><span>{name}</span>{descriptor ? <small>{isVideo ? `${descriptor.media.mime.split("/")[1].toUpperCase()} · ` : ""}{size(descriptor.media.bytes)}</small> : null}{ready ? <><button type="button" aria-label={r("download")} onClick={() => void download()}><ArrowDownTrayIcon className="hico" /></button><button type="button" aria-label={r("reveal")} onClick={() => void reveal()}><FolderIcon className="hico" /></button></> : null}</span>
    {actionNotice ? <small className="hd-media-action-notice" role="status">{actionNotice}</small> : null}
    {lightbox && descriptor && !isVideo ? createPortal(<dialog ref={dialog} className="hd-media-lightbox" aria-label={alt || name} onCancel={event => { event.preventDefault(); setLightbox(false); }} onClose={() => setLightbox(false)} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); setLightbox(false); return; } if (event.key !== "Tab") return; const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")], first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}>
      <header><span>{name}</span><button type="button" onClick={() => void copy()}>{r("copy")}</button><button type="button" onClick={() => void download()}>{r("download")}</button><button type="button" onClick={() => void reveal()}>{r("reveal")}</button><button type="button" onClick={() => setLightbox(false)}>{r("close")}</button></header><img src={workspaceMediaUrl(descriptor.media.id)} alt={alt} />{actionNotice ? <p role="status">{actionNotice}</p> : null}
    </dialog>, document.body) : null}
  </span>;
}
