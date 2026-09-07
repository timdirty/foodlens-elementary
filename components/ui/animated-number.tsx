"use client";

import { useEffect, useMemo, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

function parseNumericValue(value: string) {
  const normalized = value.replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const decimals = normalized.includes(".")
    ? (normalized.split(".")[1]?.length ?? 0)
    : 0;
  return { number: Number(normalized), decimals };
}

export function AnimatedNumber({ value }: { value: string }) {
  const parsed = useMemo(() => parseNumericValue(value), [value]);
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (!parsed || reduceMotion) return;
    const format = (number: number) =>
      number.toLocaleString("zh-TW", {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals,
      });
    const controls = animate(0, parsed.number, {
      duration: 0.65,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(format(latest)),
    });
    return () => controls.stop();
  }, [parsed, reduceMotion, value]);

  return (
    <span aria-label={value}>{!parsed || reduceMotion ? value : display}</span>
  );
}
