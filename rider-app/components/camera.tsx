"use client";
import { Camera, RotateCcw } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { capture, type Where } from "@/lib/photo";
import { ErrorText } from "./ui";

/** A blob as an <img> src for as long as it is shown. */
export function useBlobUrl(blob: Blob | null | undefined) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

/**
 * The phone's camera through a file input (capture="environment": the back
 * camera opens straight away), then a preview with Retake.
 */
export function CameraCapture({
  label,
  preview,
  onPhoto,
  guide,
  disabled = false,
  testId,
}: {
  label: string;
  preview?: Blob | null;
  onPhoto: (blob: Blob, where: Where) => void | Promise<void>;
  guide?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = useBlobUrl(preview);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, where } = await capture(file);
      await onPhoto(blob, where);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Take the photo again.");
    } finally {
      setBusy(false);
    }
  }

  const input = (
    <input
      id={id}
      data-testid={testId}
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      disabled={disabled || busy}
      onChange={(e) => void onChange(e)}
    />
  );

  if (url) {
    return (
      <div className="flex flex-col gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local photo, not an optimisable asset */}
        <img src={url} alt={`Photo: ${label}`} className="aspect-[4/3] w-full rounded-2xl bg-chip object-cover" />
        <label htmlFor={id} className={`press inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-chip px-4 font-semibold ${disabled ? "pointer-events-none opacity-60" : ""}`}>
          <RotateCcw aria-hidden size={20} /> {busy ? "Preparing…" : "Retake"}
        </label>
        {input}
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={`press relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-action bg-tint text-action ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        {guide && (
          <span aria-hidden className="pointer-events-none absolute inset-5 rounded-xl border-4 border-brand/80">
            <span className="absolute inset-x-0 -bottom-1 translate-y-full text-center text-xs" />
          </span>
        )}
        <span className="relative flex flex-col items-center gap-2 px-6 text-center">
          <Camera aria-hidden size={44} />
          <span className="text-lg font-bold">{busy ? "Preparing photo…" : label}</span>
          {guide && <span className="text-sm font-semibold text-deep">{guide}</span>}
        </span>
      </label>
      {input}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
