"use client";

import React from "react";
import { useGameMode } from "./game-mode-context";

export function GameModeToggle({ compact = false }: { compact?: boolean }) {
  const { isGameMode, setIsGameMode, stats } = useGameMode();

  return (
    <button
      type="button"
      onClick={() => setIsGameMode(!isGameMode)}
      className={`status-pill mode-toggle ${isGameMode ? "game-active" : "admin-active"}`}
      title={isGameMode ? "點擊切換為評審行政模式" : "點擊切換為國小偵探模式"}
      aria-label={
        isGameMode
          ? "目前為國小偵探模式，點擊切換為評審行政模式"
          : "目前為評審行政模式，點擊切換為國小偵探模式"
      }
    >
      <span className="mode-indicator" />
      <span className="mode-text">
        {isGameMode ? "🕵️ 國小偵探模式" : "📊 評審行政模式"}
      </span>
      {isGameMode && !compact && (
        <span className="mode-tag">Lv.{stats.level}</span>
      )}
    </button>
  );
}

export function SidebarModeToggle() {
  const { isGameMode, setIsGameMode, stats } = useGameMode();

  return (
    <div className="sidebar-mode-card">
      <div className="mode-badge">
        <span>{isGameMode ? "🕵️ 食光偵探模式" : "📊 評審行政模式"}</span>
        {isGameMode && (
          <span className="text-[10px] bg-amber-200/80 text-amber-900 px-1.5 py-0.5 rounded font-bold">
            Lv.{stats.level}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setIsGameMode(!isGameMode)}
        title="切換國小生探索介面或評審審查介面"
      >
        {isGameMode ? "切換為評審行政模式" : "進入國小偵探模式 🔍"}
      </button>
    </div>
  );
}
