import { createSerwistRoute } from "@serwist/turbopack";

const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? `${Date.now()}`;

// Serves /serwist/sw.js (Serwist's Turbopack integration builds it with esbuild).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  useNativeEsbuild: true,
  globPatterns: [".next/static/**/*.{js,css,woff2}", "public/lottie/success.json", "public/images/banners/*.jpg"],
  additionalPrecacheEntries: [{ url: "/offline", revision }],
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
});
