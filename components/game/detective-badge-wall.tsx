"use client";

import React, { useState } from "react";
import { X, Trophy, Sparkles, CheckCircle2, Lock } from "lucide-react";
import { useGameMode, type DetectiveBadge } from "./game-mode-context";

export function DetectiveBadgeWall({ onClose }: { onClose: () => void }) {
  const { badges, stats } = useGameMode();
  const [selectedBadge, setSelectedBadge] = useState<DetectiveBadge>(badges[0]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="badge-wall-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white border-2 border-amber-400 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-6 h-6 text-amber-200" />
            <div>
              <h2 id="badge-wall-title" className="text-lg font-black tracking-wide">
                食光偵探所 · 榮譽勳章館
              </h2>
              <p className="text-xs text-amber-100 font-medium">
                收集破案勳章，見證每一次守護午餐的用心！
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="關閉勳章館"
            className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-1.5 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6">
          {/* Badge Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
            {badges.map((badge) => {
              const isSelected = selectedBadge.id === badge.id;
              return (
                <button
                  key={badge.id}
                  onClick={() => setSelectedBadge(badge)}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-2xl border-2 transition-all text-center relative ${
                    isSelected
                      ? "border-amber-500 bg-amber-50 shadow-md scale-105"
                      : badge.unlocked
                        ? "border-slate-200 bg-slate-50 hover:border-amber-300 hover:bg-amber-50/50"
                        : "border-slate-200 bg-slate-100/60 opacity-60 grayscale hover:opacity-80"
                  }`}
                >
                  <span className="text-2xl mb-1">{badge.icon}</span>
                  <span className="text-[11px] font-bold text-slate-800 line-clamp-1">
                    {badge.name}
                  </span>
                  {badge.unlocked ? (
                    <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white rounded-full p-0.5 shadow-xs">
                      <CheckCircle2 className="w-3 h-3" />
                    </span>
                  ) : (
                    <span className="absolute -top-1.5 -right-1.5 bg-slate-400 text-white rounded-full p-0.5 shadow-xs">
                      <Lock className="w-3 h-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected Badge Detail Box */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white border-2 border-amber-300 shadow-sm flex items-center justify-center text-3xl shrink-0">
              {selectedBadge.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">
                  {selectedBadge.name}
                </h3>
                {selectedBadge.unlocked ? (
                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> 已解鎖 ({selectedBadge.unlockedAt})
                  </span>
                ) : (
                  <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" /> 未解鎖
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 font-medium mt-1 leading-relaxed">
                {selectedBadge.description}
              </p>
              <div className="mt-2 text-[11px] font-bold text-amber-800 bg-amber-200/50 rounded-lg px-2.5 py-1 inline-block">
                解鎖條件：{selectedBadge.requirement}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>
            當前階級：<strong className="text-amber-700">{stats.rankTitle}</strong>
          </span>
          <button
            onClick={onClose}
            className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 py-1.5 rounded-xl transition-colors"
          >
            繼續破案
          </button>
        </div>
      </div>
    </div>
  );
}
