"use client";
import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
import { Check } from "lucide-react";
import { useReducedMotion } from "motion/react";

setWasmUrl("/lottie/dotlottie-player.wasm");

/** The delivered tick: a short Lottie, or a plain tick when motion is reduced. */
export function DeliveredTick() {
  const reduce = useReducedMotion();
  return (
    <div className="grid size-32 place-items-center" data-testid="delivered-tick">
      {reduce ? (
        <span className="grid size-24 place-items-center rounded-full bg-action text-white">
          <Check aria-hidden size={52} strokeWidth={3} />
        </span>
      ) : (
        <DotLottieReact src="/lottie/success.json" autoplay loop={false} className="size-32" aria-hidden />
      )}
    </div>
  );
}
