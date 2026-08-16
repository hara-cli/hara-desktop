import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { petAnimationFor, type PetMoveDirection } from "./pet-animation";
import type { PetAsset, PetStatus } from "./pets";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function usePetFrame(
  status: PetStatus,
  movement: PetMoveDirection,
  reduced: boolean,
): { row: number; column: number } {
  const animation = useMemo(() => petAnimationFor(status, movement), [movement, status]);
  const [column, setColumn] = useState(animation.frames[0]?.column ?? 0);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let index = 0;
    setColumn(animation.frames[0]?.column ?? 0);
    if (reduced || animation.frames.length < 2) return;

    const scheduleNext = () => {
      const current = animation.frames[index];
      timer = window.setTimeout(() => {
        if (disposed) return;
        if (index < animation.frames.length - 1) index += 1;
        else if (animation.mode === "loop") index = 0;
        else return;
        setColumn(animation.frames[index].column);
        scheduleNext();
      }, current.durationMs);
    };
    scheduleNext();

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [animation, reduced]);

  return { row: animation.row, column: reduced ? 0 : column };
}

interface AtlasPetProps {
  asset: PetAsset;
  status: PetStatus;
  movement?: PetMoveDirection;
  reduced?: boolean;
  className?: string;
}

export const AtlasCanvasPet = memo(function AtlasCanvasPet({
  asset,
  status,
  movement = null,
  reduced = false,
  className = "atlas-frame",
}: AtlasPetProps) {
  const frame = usePetFrame(status, movement, reduced);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let current = true;
    const image = new Image();
    const context = canvas.current?.getContext("2d");
    context?.clearRect(0, 0, asset.frameWidth, asset.frameHeight);
    setSource(null);
    image.onload = () => {
      if (current) setSource(image);
    };
    image.src = asset.dataUrl;
    return () => {
      current = false;
    };
  }, [asset.dataUrl, asset.frameHeight, asset.frameWidth]);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !source) return;
    context.clearRect(0, 0, asset.frameWidth, asset.frameHeight);
    context.imageSmoothingEnabled = true;
    context.drawImage(
      source,
      frame.column * asset.frameWidth,
      frame.row * asset.frameHeight,
      asset.frameWidth,
      asset.frameHeight,
      0,
      0,
      asset.frameWidth,
      asset.frameHeight,
    );
  }, [asset.frameHeight, asset.frameWidth, frame.column, frame.row, source]);

  return (
    <span className={className} aria-hidden="true">
      <canvas ref={canvas} width={asset.frameWidth} height={asset.frameHeight} />
    </span>
  );
});

export const AtlasCssPet = memo(function AtlasCssPet({
  asset,
  status,
  movement = null,
  reduced = false,
  className = "pet-atlas-sprite",
}: AtlasPetProps) {
  const frame = usePetFrame(status, movement, reduced);
  const style = {
    backgroundImage: `url("${asset.dataUrl}")`,
    backgroundPosition: `${(frame.column / (asset.columns - 1)) * 100}% ${(frame.row / (asset.rows - 1)) * 100}%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${asset.columns * 100}% ${asset.rows * 100}%`,
  } as CSSProperties;
  return <span className={className} style={style} aria-hidden="true" />;
});
