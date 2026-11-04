"use client";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";

/** A number whose digits roll vertically when it changes. */
export function RollingNumber({ value, className, format = String }: { value: number; className?: string; format?: (n: number) => string }) {
  const [prev, setPrev] = useState(value);
  const [dir, setDir] = useState(1);
  if (value !== prev) {
    setDir(value > prev ? 1 : -1);
    setPrev(value);
  }
  const reduce = useReducedMotion();
  return (
    <span className={`relative inline-flex overflow-hidden tabular-nums ${className ?? ""}`} style={{ lineHeight: "inherit" }}>
      <AnimatePresence initial={false} mode="popLayout" custom={dir}>
        <m.span
          key={value}
          custom={dir}
          initial={reduce ? false : { y: `${dir * 100}%`, opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: `${dir * -100}%`, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="inline-block"
        >
          {format(value)}
        </m.span>
      </AnimatePresence>
    </span>
  );
}
