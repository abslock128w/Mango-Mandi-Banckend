"use client";
import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";

/**
 * next/image that arrives softly. Underneath sits a placeholder: the photo's own colours (a 4 px
 * copy from public/blur-placeholders.css, found by data-blur=src and blurred), or a given `tone`, or
 * the chip colour for photos that have none (API photos). The photo fades in
 * over it once decoded (opacity, --dur-m). Preloaded photos (the LCP banner, the product photo)
 * never start hidden, so they paint as early as they can; the placeholder still covers the wait.
 * For `fill` images inside a positioned box.
 */
/** The placeholders' stylesheet (scripts/blur-placeholders.mjs), added once, after the first paint. */
function useBlurSheet() {
  useEffect(() => {
    if (document.querySelector("link[data-blur-sheet]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/blur-placeholders.css";
    link.dataset.blurSheet = "";
    document.head.appendChild(link);
  }, []);
}

export function BlurImage({ alt, className, blurDataURL, tone, onLoad, ...props }: ImageProps & { tone?: string }) {
  const eager = Boolean(props.preload) || props.loading === "eager";
  const [loaded, setLoaded] = useState(false);
  useBlurSheet();
  const src = typeof props.src === "string" ? props.src : undefined;
  return (
    <>
      {!loaded && (
        <span
          aria-hidden
          data-testid="blur-placeholder"
          data-blur={blurDataURL ? undefined : src}
          className="absolute inset-0 scale-110 bg-chip bg-cover bg-center blur-md"
          style={{ backgroundColor: tone, backgroundImage: blurDataURL ? `url(${blurDataURL})` : undefined }}
        />
      )}
      <Image
        alt={alt}
        {...props}
        // Inline, so a caller's own opacity class (a sold-out photo at 50%) still applies once loaded.
        style={loaded || eager ? props.style : { ...props.style, opacity: 0 }}
        className={cn("transition-opacity duration-(--dur-m) ease-standard", className)}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
      />
    </>
  );
}
