"use client";

import React from "react";
import { Sparkles, Shield, Compass } from "lucide-react";
import { useGameMode } from "./game-mode-context";

export function GameModeToggle() {
  const { isGameMode, setIsGameMode, stats } = useGameMode();

  return (
    <div className="flex items-center gap-1.5 bg-amber-100/90 border-2 border-amber-300 rounded-full px-2.5 py-1 shadow-xs">
      <button
        type="button"
        onClick={() => setIsGameMode(!isGameMode)}
        className="flex items-center gap-1.5 text-xs font-black text-amber-950 hover:text-amber-800 transition-colors"
        title="切換學生偵探模式 / 評審模式"
        aria-label={isGameMode ? "切換至評審行政模式" : "切換至國小偵探遊戲模式"}
      >
        {isGameMode ? (
          <>
            <span className="text-sm">🕵️‍♂️</span>
            <span className="hidden sm:inline">國小偵探模式</span>
            <span className="bg-amber-400 text-amber-950 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
              Lv.{stats.level}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm">📊</span>
            <span className="hidden sm:inline">評審行政模式</span>
            <span className="text-[10px] text-slate-500 font-semibold">(點擊切換遊戲)</span>
          </>
        )}
      </button>
    </div>
  );
}
