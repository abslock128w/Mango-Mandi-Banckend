"use client";
import dynamic from "next/dynamic";

// Overlays load after first paint so they don't compete with the LCP image.
export const CartPanel = dynamic(() => import("@/features/cart/components/cart-panel").then((m) => m.CartPanel), { ssr: false });
export const ProductSheet = dynamic(() => import("@/features/product/components/product-sheet").then((m) => m.ProductSheet), { ssr: false });
export const LocationGate = dynamic(() => import("@/features/location/components/location-gate").then((m) => m.LocationGate), { ssr: false });
export const CartBar = dynamic(() => import("@/features/cart/components/cart-bar").then((m) => m.CartBar), { ssr: false });
export const Toaster = dynamic(() => import("@/features/shell/toaster").then((m) => m.Toaster), { ssr: false });
