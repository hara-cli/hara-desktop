import { MAX_AGENT_AVATAR_BYTES, renderableAgentAvatar } from "./agent-visual.ts";

export class AvatarImageError extends Error {
  readonly code: "tooLarge" | "format" | "dimensions" | "decode" | "encode";
  constructor(code: AvatarImageError["code"]) { super(`Avatar image: ${code}`); this.name = "AvatarImageError"; this.code = code; }
}
export function avatarImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  return null;
}
export function squareAvatarCrop(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_777_216) throw new AvatarImageError("dimensions");
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side, output: Math.min(256, side) };
}

/** Decodes only an explicitly selected, bounded PNG/JPEG. No URL, filesystem path or network read. */
export async function prepareAgentAvatar(file: Pick<File, "size" | "arrayBuffer">, signal?: AbortSignal): Promise<string> {
  const active = () => { if (signal?.aborted) throw new DOMException("Avatar selection cancelled", "AbortError"); };
  active();
  if (!Number.isSafeInteger(file.size) || file.size < 1) throw new AvatarImageError("format");
  if (file.size > MAX_AGENT_AVATAR_BYTES) throw new AvatarImageError("tooLarge");
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { throw new AvatarImageError("decode"); }
  active();
  if (bytes.length > MAX_AGENT_AVATAR_BYTES) throw new AvatarImageError("tooLarge");
  const mime = avatarImageMime(bytes);
  if (!mime) throw new AvatarImageError("format");
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  const input = `data:${mime};base64,${btoa(binary)}`, image = new Image();
  let stopLoading: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (cause?: Error) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); image.onload = image.onerror = null; cause ? reject(cause) : resolve(); };
      const abort = () => { finish(new DOMException("Avatar selection cancelled", "AbortError")); image.src = ""; };
      const timer = setTimeout(() => { finish(new AvatarImageError("decode")); image.src = ""; }, 10000);
      stopLoading = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); image.onload = image.onerror = null; };
      image.onload = () => finish();
      image.onerror = () => finish(new AvatarImageError("decode"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort(); else image.src = input;
    });
    active();
    const crop = squareAvatarCrop(image.naturalWidth, image.naturalHeight);
    const sizes = [...new Set([crop.output, 192, 128, 96, 64].filter(size => size <= crop.output))];
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (!context) throw new AvatarImageError("encode");
    for (const size of sizes) {
      canvas.width = canvas.height = size;
      context.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
      const output = canvas.toDataURL(mime, mime === "image/jpeg" ? 0.9 : undefined);
      if (renderableAgentAvatar({ version: 1, source: "derived", displayName: "Avatar", avatar: output })) return output;
    }
    throw new AvatarImageError("tooLarge");
  } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") throw cause; if (cause instanceof AvatarImageError) throw cause; throw new AvatarImageError("encode"); }
  finally { stopLoading?.(); }
}
