"use client";

import React, { useState } from "react";
import { Award, Flame, Sparkles, Shield, ChevronRight, Trophy } from "lucide-react";
import { useGameMode } from "./game-mode-context";
import { DetectiveBadgeWall } from "./detective-badge-wall";

export function DetectiveRankCard() {
  const { isGameMode, stats, badges } = useGameMode();
  const [showBadgeWall, setShowBadgeWall] = useState(false);

  if (!isGameMode) return null;

  const currentLevelMax =
    stats.level === 1 ? 100 : stats.level === 2 ? 300 : stats.level === 3 ? 600 : 1000;
  const currentLevelBase =
    stats.level === 1 ? 0 : stats.level === 2 ? 100 : stats.level === 3 ? 300 : 600;
  const progressPercent = Math.min(
    100,
    Math.max(
      0,
      ((stats.xp - currentLevelBase) / (currentLevelMax - currentLevelBase)) * 100
    )
  );

  const unlockedCount = badges.filter((b) => b.unlocked).length;

  return (
    <>
      <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-100 border-2 border-amber-300 rounded-2xl p-4 shadow-sm relative overflow-hidden mb-6">
        {/* Background Decorative Stamp */}
        <div className="absolute -right-4 -bottom-6 text-amber-200/50 text-8xl font-black select-none pointer-events-none rotate-12">
          DETECTIVE
        </div>

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          {/* Left: Rank & XP Progress */}
          <div className="flex items-center gap-3.5">
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center text-2xl shadow-md border-2 border-white shrink-0">
              {stats.level === 1 ? "🥉" : stats.level === 2 ? "🥈" : stats.level === 3 ? "🥇" : "👑"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800 bg-amber-200/80 px-2 py-0.5 rounded-md">
                  食光偵探所 · 榮譽階級
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  Lv.{stats.level}
                </span>
              </div>
              <h3 className="text-lg font-black text-slate-900 mt-0.5 flex items-center gap-1.5">
                <span>{stats.rankTitle}</span>
                <Sparkles className="w-4 h-4 text-amber-500 inline" />
              </h3>

              {/* Progress bar */}
              <div className="flex items-center gap-2 mt-1.5">
                <div className="w-36 sm:w-48 h-2 bg-amber-200/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-600"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-amber-900">
                  {stats.xp} / {currentLevelMax} XP
                </span>
              </div>
            </div>
          </div>

          {/* Right: Quick Stats & Badge Button */}
          <div className="flex items-center gap-2.5 sm:gap-4 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-amber-200/60">
            {/* Streak */}
            <div className="flex items-center gap-1.5 bg-white/80 border border-amber-200 px-3 py-1.5 rounded-xl shadow-xs">
              <Flame className="w-4 h-4 text-orange-500 animate-pulse" />
              <div>
                <div className="text-[10px] font-semibold text-slate-500 leading-none">連勝守護</div>
                <div className="text-sm font-black text-orange-600 leading-tight">{stats.streakDays} 天</div>
              </div>
            </div>

            {/* Rice Saved */}
            <div className="flex items-center gap-1.5 bg-white/80 border border-amber-200 px-3 py-1.5 rounded-xl shadow-xs">
              <span className="text-base">🍚</span>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 leading-none">拯救白飯</div>
                <div className="text-sm font-black text-amber-700 leading-tight">約 {stats.rescuedBowls} 碗</div>
              </div>
            </div>

            {/* Badges Button */}
            <button
              onClick={() => setShowBadgeWall(true)}
              className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-xl shadow-sm hover:shadow text-xs flex items-center gap-1 transition-all active:scale-95"
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>成就徽章 ({unlockedCount}/{badges.length})</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {showBadgeWall && (
        <DetectiveBadgeWall onClose={() => setShowBadgeWall(false)} />
      )}
    </>
  );
}
