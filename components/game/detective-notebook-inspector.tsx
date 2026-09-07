"use client";

import React, { useState, useRef } from "react";
import { Stamp, StickyNote } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface StampItem {
  id: string;
  name: string;
  emoji: string;
}

const AVAILABLE_STAMPS: StampItem[] = [
  { id: "clean", name: "全盤清空", emoji: "💮" },
  { id: "try-veggie", name: "勇敢嘗試蔬菜", emoji: "🥦" },
  { id: "bone", name: "骨頭已精確扣除", emoji: "🦴" },
  { id: "refill", name: "份量拿捏恰好", emoji: "🥄" },
];

interface AppliedStamp {
  id: number;
  stamp: StampItem;
}

export function DetectiveNotebookInspector() {
  const { isGameMode, addXp } = useGameMode();
  const nextIdRef = useRef(3);
  const [appliedStamps, setAppliedStamps] = useState<AppliedStamp[]>([
    { id: 1, stamp: AVAILABLE_STAMPS[0] },
    { id: 2, stamp: AVAILABLE_STAMPS[2] },
  ]);

  if (!isGameMode) return null;

  const handleApplyStamp = (stamp: StampItem) => {
    const newStamp: AppliedStamp = {
      id: nextIdRef.current++,
      stamp,
    };
    setAppliedStamps((prev) => [...prev, newStamp]);
    addXp(10);
  };

  const clearStamps = () => {
    setAppliedStamps([]);
  };

  return (
    <div className="bg-[#fffdf8] border border-[#ebd9b5] rounded-xl p-4 mt-6 shadow-xs relative">
      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-[#ebd9b5]/80">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-[#7a4f10]" />
          <h4 className="text-xs font-black text-[#4f330b] flex items-center gap-1.5">
            <span>食光偵探手帳 · 現場觀察鑑定章</span>
          </h4>
        </div>
        <span className="text-[10px] bg-[#fdf2dc] text-[#7a4f10] border border-[#ebd9b5] font-bold px-2 py-0.5 rounded">
          國小組觀察工具
        </span>
      </div>

      <p className="text-[11px] text-[var(--ink)] font-medium leading-relaxed mb-3">
        🔍 <strong>小偵探現場備忘：</strong>
        除了 AI
        數據，國小生的眼睛最懂得現場細節！點擊下方鑑定章，標記今天的餐盤特色（如：骨頭已扣除、勇敢嘗試青菜）。
      </p>

      {/* Stamp Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-lg border border-[#ebd9b5]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-[#7a4f10] mr-1 flex items-center gap-1">
            <Stamp className="w-3.5 h-3.5 text-[#d99432]" />
            <span>蓋鑑定章：</span>
          </span>
          {AVAILABLE_STAMPS.map((stamp) => (
            <button
              key={stamp.id}
              type="button"
              onClick={() => handleApplyStamp(stamp)}
              className="flex items-center gap-1 bg-[#fffdf8] hover:bg-[#faeed7] border border-[#ebd9b5] px-2 py-1 rounded text-xs font-bold text-[#4f330b] transition-all hover:scale-102 active:scale-98 shadow-xs"
              title={`蓋上「${stamp.name}」印章 (+10 XP)`}
            >
              <span>{stamp.emoji}</span>
              <span className="text-[10px]">{stamp.name}</span>
            </button>
          ))}
        </div>

        {appliedStamps.length > 0 && (
          <button
            type="button"
            onClick={clearStamps}
            className="text-[10px] text-slate-500 hover:text-slate-800 underline"
          >
            重置印章
          </button>
        )}
      </div>

      {/* Active Stamp Badges on Display */}
      {appliedStamps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="text-[10px] font-bold text-[#7a4f10] py-0.5">
            本餐盤觀察記號：
          </span>
          {appliedStamps.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 bg-white border border-[#ebd9b5] text-[#4f330b] text-[10px] font-bold px-2 py-0.5 rounded-full shadow-xs"
            >
              <span>{item.stamp.emoji}</span>
              <span>{item.stamp.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
