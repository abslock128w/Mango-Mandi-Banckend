"use client";
import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { blurFor } from "@/lib/blur-placeholders";
import { cn } from "@/lib/format";

/**
 * next/image that arrives softly. Underneath sits a placeholder: the photo's own colours (a 4 px
 * copy from lib/blur-placeholders.ts, blurred), a given `tone`, or the shimmer. The photo fades in
 * over it once decoded (opacity, --dur-m). Preloaded photos (the LCP banner, the product photo)
 * never start hidden, so they paint as early as they can; the placeholder still covers the wait.
 * For `fill` images inside a positioned box.
 */
export function BlurImage({ alt, className, blurDataURL, tone, onLoad, ...props }: ImageProps & { tone?: string }) {
  const eager = Boolean(props.preload) || props.loading === "eager";
  const [loaded, setLoaded] = useState(false);
  const blur = blurDataURL ?? (typeof props.src === "string" ? blurFor(props.src) : undefined);
  return (
    <>
      {!loaded && (
        <span
          aria-hidden
          data-testid="blur-placeholder"
          className={cn("absolute inset-0 overflow-hidden", !blur && !tone && "skeleton")}
          style={{
            backgroundColor: tone,
            backgroundImage: blur ? `url(${blur})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: blur ? "blur(12px)" : undefined,
            transform: blur ? "scale(1.1)" : undefined,
          }}
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
