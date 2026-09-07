"use client";

import React, { useState } from "react";
import { Sparkles, Stamp, Check, StickyNote, HelpCircle, X } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface StampItem {
  id: string;
  name: string;
  emoji: string;
  color: string;
  textColor: string;
}

const AVAILABLE_STAMPS: StampItem[] = [
  { id: "clean", name: "完食神蹟", emoji: "💮", color: "bg-red-500", textColor: "text-white" },
  { id: "picky", name: "挑食大魔王", emoji: "👿", color: "bg-purple-600", textColor: "text-white" },
  { id: "bone", name: "骨頭避難所", emoji: "🦴", color: "bg-amber-600", textColor: "text-white" },
  { id: "refill", name: "再來一碗", emoji: "🥄", color: "bg-emerald-600", textColor: "text-white" },
];

interface AppliedStamp {
  id: number;
  stamp: StampItem;
  x: number;
  y: number;
  rotation: number;
}

export function DetectiveNotebookInspector() {
  const { isGameMode, addXp } = useGameMode();
  const [selectedStamp, setSelectedStamp] = useState<StampItem | null>(null);
  const [appliedStamps, setAppliedStamps] = useState<AppliedStamp[]>([
    {
      id: 1,
      stamp: AVAILABLE_STAMPS[0],
      x: 35,
      y: 40,
      rotation: -12,
    },
    {
      id: 2,
      stamp: AVAILABLE_STAMPS[1],
      x: 65,
      y: 70,
      rotation: 8,
    },
  ]);

  if (!isGameMode) return null;

  const handleApplyStamp = (stamp: StampItem) => {
    setSelectedStamp(stamp);
    const newStamp: AppliedStamp = {
      id: Date.now(),
      stamp,
      x: Math.floor(Math.random() * 50) + 25,
      y: Math.floor(Math.random() * 50) + 25,
      rotation: Math.floor(Math.random() * 30) - 15,
    };
    setAppliedStamps((prev) => [...prev, newStamp]);
    addXp(10);
  };

  const clearStamps = () => {
    setAppliedStamps([]);
  };

  return (
    <div className="bg-amber-50/90 border-2 border-amber-300 rounded-2xl p-4 shadow-sm relative mb-4">
      {/* Tape decoration on top */}
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-5 bg-amber-200/80 border border-amber-300/80 rotate-1 shadow-xs" />

      <div className="flex items-center justify-between gap-2 mb-2 pt-1 border-b border-amber-200 pb-2">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-amber-700" />
          <h4 className="text-xs font-black text-amber-950 flex items-center gap-1.5">
            <span>食光偵探手帳 · 現場勘查工具</span>
          </h4>
        </div>
        <span className="text-[10px] bg-amber-200 text-amber-900 font-bold px-2 py-0.5 rounded-md">
          國小組互動
        </span>
      </div>

      <p className="text-[11px] text-slate-700 font-medium leading-relaxed mb-3">
        🔍 <strong>偵探小隊現場觀察手記：</strong>
        <br />
        今日主菜照燒排骨大受好評，白飯幾乎吃光；但副菜青菜有部分同學挑食。
        點擊下方印章，直接為餐盤蓋上你的「偵探鑑定章」！
      </p>

      {/* Stamp Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white/80 p-2.5 rounded-xl border border-amber-200">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-amber-900 mr-1 flex items-center gap-1">
            <Stamp className="w-3.5 h-3.5 text-amber-600" />
            <span>蓋鑑定章：</span>
          </span>
          {AVAILABLE_STAMPS.map((stamp) => (
            <button
              key={stamp.id}
              type="button"
              onClick={() => handleApplyStamp(stamp)}
              className="flex items-center gap-1 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-1 rounded-lg text-xs font-bold text-amber-950 transition-transform hover:scale-105 active:scale-95 shadow-xs"
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
            清除印章
          </button>
        )}
      </div>

      {/* Active Stamp Badges on Display */}
      {appliedStamps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <span className="text-[10px] font-bold text-amber-800 py-0.5">已蓋印記：</span>
          {appliedStamps.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 bg-white border border-amber-300 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full shadow-xs animate-in zoom-in-50 duration-150"
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
