"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export interface DetectiveBadge {
  id: string;
  name: string;
  icon: string;
  description: string;
  unlocked: boolean;
  unlockedAt?: string;
  requirement: string;
}

export interface DetectiveStats {
  xp: number;
  level: number;
  rankTitle: string;
  streakDays: number;
  solvedCasesCount: number;
  rescuedBowls: number;
  unlockedBadgeIds: string[];
}

const DEFAULT_BADGES: DetectiveBadge[] = [
  {
    id: "first-case",
    name: "初入偵探社",
    icon: "🔍",
    description: "成功破獲第一起午餐剩食謎案，建立完整證據鏈！",
    unlocked: true,
    unlockedAt: "2026-09-01",
    requirement: "完成 1 次完整餐期調查",
  },
  {
    id: "clean-plate-hero",
    name: "青菜消滅大師",
    icon: "🥦",
    description: "全班蔬菜類剩餘率連續低於 15%，神隊友出動！",
    unlocked: true,
    unlockedAt: "2026-09-03",
    requirement: "蔬菜類剩食率 < 15%",
  },
  {
    id: "eagle-eye",
    name: "鷹眼校正員",
    icon: "🦅",
    description: "手動抓出 AI 辨識瑕疵並校正，捍衛數據真實性！",
    unlocked: true,
    unlockedAt: "2026-09-05",
    requirement: "完成 3 次餐盤手動校正",
  },
  {
    id: "sharp-forecaster",
    name: "精準神測手",
    icon: "🎯",
    description: "在供餐預測中完成科學試算，兼顧營養與防浪費！",
    unlocked: false,
    requirement: "完成 1 次下餐供應量試算",
  },
  {
    id: "streak-master",
    name: "光盤連勝王",
    icon: "🔥",
    description: "連續 5 個供餐日守護校園餐盤，養成愛食好習慣！",
    unlocked: true,
    unlockedAt: "2026-09-06",
    requirement: "連續 5 天完成破案記錄",
  },
  {
    id: "food-guardian",
    name: "惜食大宗師",
    icon: "👑",
    description: "累積拯救超過 100 碗白飯與等量碳排，榮登傳奇名偵探！",
    unlocked: false,
    requirement: "累計拯救超過 100 碗白飯",
  },
];

interface GameModeContextType {
  isGameMode: boolean;
  setIsGameMode: (enabled: boolean) => void;
  stats: DetectiveStats;
  badges: DetectiveBadge[];
  addXp: (amount: number, reason?: string) => void;
  unlockBadge: (badgeId: string) => void;
  celebrationTrigger: { active: boolean; caseName?: string; bowls?: number };
  triggerCelebration: (caseName: string, bowls?: number) => void;
  dismissCelebration: () => void;
}

const GameModeContext = createContext<GameModeContextType | null>(null);

function calculateRank(xp: number): { level: number; rankTitle: string } {
  if (xp >= 600) return { level: 4, rankTitle: "食光大名偵探 👑" };
  if (xp >= 300) return { level: 3, rankTitle: "營養破案家 🥇" };
  if (xp >= 100) return { level: 2, rankTitle: "剩食巡察使 🥈" };
  return { level: 1, rankTitle: "見習小偵探 🥉" };
}

const STORAGE_KEY_MODE = "foodlens_game_mode";
const STORAGE_KEY_STATS = "foodlens_detective_stats_v1";

export function GameModeProvider({ children }: { children: React.ReactNode }) {
  const [isGameMode, setIsGameModeState] = useState<boolean>(true);
  const [stats, setStats] = useState<DetectiveStats>({
    xp: 280,
    level: 2,
    rankTitle: "剩食巡察使 🥈",
    streakDays: 5,
    solvedCasesCount: 14,
    rescuedBowls: 86,
    unlockedBadgeIds: ["first-case", "clean-plate-hero", "eagle-eye", "streak-master"],
  });
  const [badges, setBadges] = useState<DetectiveBadge[]>(DEFAULT_BADGES);
  const [celebrationTrigger, setCelebrationTrigger] = useState<{
    active: boolean;
    caseName?: string;
    bowls?: number;
  }>({ active: false });

  // Read from localStorage on mount
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(STORAGE_KEY_MODE);
      if (savedMode !== null) {
        setIsGameModeState(savedMode === "true");
      }
      const savedStats = localStorage.getItem(STORAGE_KEY_STATS);
      if (savedStats) {
        const parsed = JSON.parse(savedStats);
        const { level, rankTitle } = calculateRank(parsed.xp || 280);
        setStats({ ...parsed, level, rankTitle });
      }
    } catch {
      // ignore
    }
  }, []);

  const setIsGameMode = (enabled: boolean) => {
    setIsGameModeState(enabled);
    try {
      localStorage.setItem(STORAGE_KEY_MODE, String(enabled));
    } catch {}
  };

  const addXp = (amount: number) => {
    setStats((prev) => {
      const newXp = prev.xp + amount;
      const { level, rankTitle } = calculateRank(newXp);
      const updated = {
        ...prev,
        xp: newXp,
        level,
        rankTitle,
        solvedCasesCount: prev.solvedCasesCount + 1,
        rescuedBowls: prev.rescuedBowls + Math.floor(amount / 5),
      };
      try {
        localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const unlockBadge = (badgeId: string) => {
    setBadges((prev) =>
      prev.map((b) =>
        b.id === badgeId
          ? {
              ...b,
              unlocked: true,
              unlockedAt: new Date().toISOString().split("T")[0],
            }
          : b
      )
    );
    setStats((prev) => {
      if (prev.unlockedBadgeIds.includes(badgeId)) return prev;
      const updated = {
        ...prev,
        unlockedBadgeIds: [...prev.unlockedBadgeIds, badgeId],
      };
      try {
        localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const triggerCelebration = (caseName: string, bowls = 12) => {
    setCelebrationTrigger({ active: true, caseName, bowls });
    addXp(50);
  };

  const dismissCelebration = () => {
    setCelebrationTrigger({ active: false });
  };

  return (
    <GameModeContext.Provider
      value={{
        isGameMode,
        setIsGameMode,
        stats,
        badges,
        addXp,
        unlockBadge,
        celebrationTrigger,
        triggerCelebration,
        dismissCelebration,
      }}
    >
      {children}
    </GameModeContext.Provider>
  );
}

const DEFAULT_FALLBACK_CTX: GameModeContextType = {
  isGameMode: true,
  setIsGameMode: () => {},
  stats: {
    xp: 280,
    level: 2,
    rankTitle: "剩食巡察使 🥈",
    streakDays: 5,
    solvedCasesCount: 14,
    rescuedBowls: 86,
    unlockedBadgeIds: ["first-case", "clean-plate-hero", "eagle-eye", "streak-master"],
  },
  badges: DEFAULT_BADGES,
  addXp: () => {},
  unlockBadge: () => {},
  celebrationTrigger: { active: false },
  triggerCelebration: () => {},
  dismissCelebration: () => {},
};

export function useGameMode() {
  const ctx = useContext(GameModeContext);
  return ctx ?? DEFAULT_FALLBACK_CTX;
}
