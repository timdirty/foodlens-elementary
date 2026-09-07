"use client";

import React, { useState } from "react";
import { Search, Sparkles, Scan, Crosshair, HelpCircle, Check } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface DetectiveScannerOverlayProps {
  isScanning?: boolean;
  onTargetClick?: (targetName: string) => void;
}

export function DetectiveScannerOverlay({
  isScanning = false,
  onTargetClick,
}: DetectiveScannerOverlayProps) {
  const { isGameMode } = useGameMode();
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  if (!isGameMode) return null;

  const targets = [
    {
      id: "staple",
      name: "主食 · 白米飯",
      x: "28%",
      y: "35%",
      suspectRate: "剩餘約 10%",
      status: "safe",
      note: "線索：白飯消滅率佳，學生飽足感充足！",
    },
    {
      id: "main",
      name: "主菜 · 照燒排骨",
      x: "70%",
      y: "35%",
      suspectRate: "剩餘約 5%",
      status: "safe",
      note: "線索：大受歡迎！幾乎清盤，注意不可食骨頭秤重。",
    },
    {
      id: "veggie",
      name: "副菜 · 鮮甜青江菜",
      x: "32%",
      y: "70%",
      suspectRate: "剩餘約 25%",
      status: "warning",
      note: "線索警戒：青菜有剩餘，可調查是否調味偏油或偏冷。",
    },
    {
      id: "soup",
      name: "湯品 · 玉米濃湯",
      x: "72%",
      y: "70%",
      suspectRate: "剩餘約 8%",
      status: "safe",
      note: "線索：湯品見底，適逢秋冬季節受熱烈歡迎。",
    },
  ];

  return (
    <div className="relative w-full h-full pointer-events-none select-none">
      {/* Radar Scan Beam Line (Active when scanning) */}
      {isScanning && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-20">
          <div className="w-full h-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_15px_#F59E0B] animate-radar-sweep" />
          <div className="absolute inset-0 bg-amber-500/10 backdrop-contrast-125" />
          <div className="absolute top-3 left-3 bg-amber-500 text-slate-950 font-black text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-md">
            <Scan className="w-3.5 h-3.5 animate-spin" />
            <span>食光偵探光學勘查中...</span>
          </div>
        </div>
      )}

      {/* Interactive Targets */}
      {!isScanning && (
        <div className="absolute inset-0 z-10 pointer-events-auto">
          {targets.map((target) => {
            const isSelected = activeTarget === target.id;
            return (
              <div
                key={target.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2"
                style={{ left: target.x, top: target.y }}
              >
                <button
                  onClick={() => {
                    setActiveTarget(isSelected ? null : target.id);
                    if (onTargetClick) onTargetClick(target.name);
                  }}
                  className={`relative p-2 rounded-full border-2 shadow-lg transition-all duration-300 group ${
                    isSelected
                      ? "bg-amber-500 border-white scale-125 text-white"
                      : target.status === "warning"
                        ? "bg-red-500/80 border-white text-white hover:scale-115 animate-pulse"
                        : "bg-amber-400/80 border-white text-slate-950 hover:scale-115"
                  }`}
                  title={target.name}
                >
                  <Crosshair className="w-4 h-4" />
                  <span className="absolute -inset-1 rounded-full border border-amber-300 animate-ping opacity-60 pointer-events-none" />
                </button>

                {/* Popover Clue Card */}
                {isSelected && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-slate-900/95 text-white border border-amber-400/80 rounded-xl p-3 shadow-2xl z-30 text-left animate-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between text-xs font-black text-amber-300 mb-1">
                      <span>{target.name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          target.status === "warning"
                            ? "bg-red-500/80 text-white"
                            : "bg-emerald-500/80 text-white"
                        }`}
                      >
                        {target.suspectRate}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">
                      {target.note}
                    </p>
                    <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] text-amber-400/80">
                      <span>點擊格位可手動校正</span>
                      <Sparkles className="w-3 h-3" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
