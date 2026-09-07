"use client";

import React, { useEffect, useState } from "react";
import { Sparkles, Trophy, X, ShieldCheck, Share2, CheckCircle2 } from "lucide-react";
import { useGameMode } from "./game-mode-context";

export function CaseClosedCelebration() {
  const { celebrationTrigger, dismissCelebration, stats } = useGameMode();
  const [copied, setCopied] = useState(false);

  if (!celebrationTrigger.active) return null;

  const caseName = celebrationTrigger.caseName || "今日午餐證據鏈";
  const bowls = celebrationTrigger.bowls || 14;

  const handleShare = () => {
    navigator.clipboard.writeText(
      `🔎【FoodLens 食光偵探破案報捷】\n今日案件「${caseName}」順利偵破！\n我們全班成功守護了約 ${bowls} 碗熱騰騰白飯，減少約 ${(bowls * 0.16 * 2.5).toFixed(1)} kg 碳排放！\n偵探階級：${stats.rankTitle}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-closed-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-300"
    >
      <div className="bg-white border-4 border-amber-400 rounded-3xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden text-center animate-in zoom-in-90 duration-300">
        {/* Colorful top garland / sparkles */}
        <div className="absolute top-0 left-0 right-0 h-3 bg-gradient-to-r from-red-500 via-amber-400 to-emerald-500" />
        <div className="text-5xl mb-2 animate-bounce mt-2">🎉</div>

        <div className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black px-3 py-1 rounded-full mb-3">
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          <span>食光偵探所 · 案件偵破認證</span>
        </div>

        <h2 id="case-closed-title" className="text-2xl font-black text-slate-900 tracking-tight mb-1">
          今日午餐案件，宣告結案！
        </h2>
        <p className="text-xs text-slate-500 font-medium mb-5">
          案件：<strong>{caseName}</strong> · 完整證據鏈已封存入庫
        </p>

        {/* Rewards Box */}
        <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 border-2 border-amber-300 rounded-2xl p-4 mb-5 shadow-xs">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-white/80 rounded-xl p-2.5 border border-amber-200">
              <div className="text-[11px] font-bold text-amber-800">破案經驗值</div>
              <div className="text-xl font-black text-amber-600">+50 XP ⚡</div>
            </div>
            <div className="bg-white/80 rounded-xl p-2.5 border border-amber-200">
              <div className="text-[11px] font-bold text-amber-800">拯救食物</div>
              <div className="text-xl font-black text-emerald-700">約 {bowls} 碗飯 🍚</div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-700">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>目前階級：{stats.rankTitle}</span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3 justify-center">
          <button
            onClick={handleShare}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors"
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>已複製破案戰報！</span>
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4" />
                <span>複製破案戰報</span>
              </>
            )}
          </button>

          <button
            onClick={dismissCelebration}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-black py-2.5 px-4 rounded-xl text-xs shadow-md transition-transform active:scale-95"
          >
            收入偵探檔案 📁
          </button>
        </div>

        <button
          onClick={dismissCelebration}
          aria-label="關閉結案通知"
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-full"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
