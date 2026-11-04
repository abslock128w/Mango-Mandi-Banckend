import { createSerwistRoute } from "@serwist/turbopack";

const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? `${Date.now()}`;

// Serves /serwist/sw.js (Serwist's Turbopack integration builds it with esbuild).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  useNativeEsbuild: true,
  globPatterns: [".next/static/**/*.{js,css,woff2}", "public/lottie/*", "public/vendor/*.js"],
  additionalPrecacheEntries: [
    { url: "/", revision },
    { url: "/today", revision },
    { url: "/pickup", revision },
    { url: "/stop", revision },
    { url: "/done", revision },
  ],
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
});
