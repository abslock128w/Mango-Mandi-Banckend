"use client";
import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { cn } from "@/lib/format";

/**
 * next/image that arrives softly: a placeholder (the 8 px blurred image from
 * lib/blur-placeholders.ts, or a flat colour) sits underneath and the picture fades in over it
 * when it has decoded (opacity, --dur-m). For `fill` images inside a positioned box.
 * Images that are preloaded (the LCP banner) skip the fade, so they paint as early as possible.
 */
export function BlurImage({ alt, className, blurDataURL, tone, onLoad, ...props }: ImageProps & { tone?: string }) {
  const eager = Boolean(props.preload) || props.loading === "eager";
  const [loaded, setLoaded] = useState(eager);
  return (
    <>
      {!loaded && (
        <span
          aria-hidden
          data-testid="blur-placeholder"
          className={cn("absolute inset-0 overflow-hidden", !blurDataURL && !tone && "skeleton")}
          style={{
            backgroundColor: tone,
            backgroundImage: blurDataURL ? `url(${blurDataURL})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: blurDataURL ? "blur(12px)" : undefined,
          }}
        />
      )}
      <Image
        alt={alt}
        {...props}
        // Inline, so a caller's own opacity class (a sold-out photo at 50%) still applies once loaded.
        style={loaded ? props.style : { ...props.style, opacity: 0 }}
        className={cn("transition-opacity duration-(--dur-m) ease-standard", className)}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
      />
    </>
  );
}
