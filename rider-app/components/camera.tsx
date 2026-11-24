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

/** Four corner marks, like a camera's viewfinder: where the box should sit. */
function Viewfinder() {
  const corner = "absolute size-9 border-green";
  return (
    <span aria-hidden className="pointer-events-none absolute inset-5">
      <span className={`${corner} top-0 left-0 rounded-tl-xl border-t-4 border-l-4`} />
      <span className={`${corner} top-0 right-0 rounded-tr-xl border-t-4 border-r-4`} />
      <span className={`${corner} bottom-0 left-0 rounded-bl-xl border-b-4 border-l-4`} />
      <span className={`${corner} right-0 bottom-0 rounded-br-xl border-r-4 border-b-4`} />
    </span>
  );
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
  const off = disabled ? "pointer-events-none" : "";

  if (url) {
    return (
      <div className="flex flex-col gap-3">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-chip">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local photo, not an optimisable asset */}
          <img src={url} alt={`Photo: ${label}`} className="aspect-[4/3] w-full object-cover" />
        </div>
        <label
          htmlFor={id}
          className={`press inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-green bg-paper px-4 text-lg font-semibold text-green ${disabled ? `${off} border-disabled text-disabled-ink` : ""}`}
        >
          <RotateCcw aria-hidden size={22} /> {busy ? "Preparing…" : "Retake"}
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
        className={`press relative grid aspect-[4/3] w-full place-items-center rounded-2xl border-2 border-dashed border-green bg-green-soft py-10 text-green ${off}`}
      >
        <Viewfinder />
        <span className="relative flex flex-col items-center gap-3 px-8 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-green text-white shadow-card">
            <Camera aria-hidden size={30} />
          </span>
          <span className="text-xl font-bold">{busy ? "Preparing photo…" : label}</span>
          {guide && <span className="text-base font-medium text-ink">{guide}</span>}
        </span>
      </label>
      {input}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
