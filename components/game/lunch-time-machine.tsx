"use client";

import React, { useState } from "react";
import { Sparkles, Wand2, ArrowRight, RotateCcw, Smile, Frown, Utensils } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface MainDish {
  id: string;
  name: string;
  emoji: string;
  baseRate: number; // leftover rate %
  note: string;
}

interface CampusScenario {
  id: string;
  name: string;
  emoji: string;
  rateDelta: number; // delta to leftover rate %
  description: string;
}

const DISH_OPTIONS: MainDish[] = [
  {
    id: "chicken",
    name: "照燒蜜汁雞翅",
    emoji: "🍗",
    baseRate: 5,
    note: "全校人氣第一名！骨頭需另外秤重，白肉吃光率 95%！",
  },
  {
    id: "pork",
    name: "經典鐵路大排骨",
    emoji: "🥩",
    baseRate: 8,
    note: "香味撲鼻！同學搶著添飯，剩食率極低。",
  },
  {
    id: "curry",
    name: "日式甘口咖哩豬肉",
    emoji: "🍛",
    baseRate: 4,
    note: "白飯殺手！只要有咖哩，班級飯桶基本上都會見底！",
  },
  {
    id: "bitter",
    name: "家常蒜蓉炒苦瓜",
    emoji: "🥒",
    baseRate: 42,
    note: "挑食大魔王現身！多數國小同學怕苦味，需靠搭配調味破除心魔。",
  },
];

const SCENARIOS: CampusScenario[] = [
  {
    id: "dodgeball",
    name: "下午有全校躲避球賽！",
    emoji: "🏃",
    rateDelta: -6,
    description: "運動量爆棚，大家的肚子咕嚕叫，食量大增！",
  },
  {
    id: "exam-done",
    name: "剛剛考完期中考！",
    emoji: "🥳",
    rateDelta: -4,
    description: "心情無比輕鬆，心情好胃口就好，吃光光！",
  },
  {
    id: "cold-weather",
    name: "寒流來襲氣溫 12 度！",
    emoji: "❄️",
    rateDelta: -3,
    description: "身體需要熱量禦寒，熱熱的午餐大受歡迎！",
  },
  {
    id: "normal",
    name: "平凡平常的校園上課日",
    emoji: "📚",
    rateDelta: 0,
    description: "按照平時作息規律打菜與用餐。",
  },
];

export function LunchTimeMachine() {
  const { isGameMode, addXp } = useGameMode();
  const [selectedDish, setSelectedDish] = useState<MainDish>(DISH_OPTIONS[2]); // Curry
  const [selectedScenario, setSelectedScenario] = useState<CampusScenario>(SCENARIOS[0]); // Dodgeball
  const [hasSimulated, setHasSimulated] = useState(false);

  if (!isGameMode) return null;

  // Calculate final simulated leftover rate
  const finalRate = Math.max(
    2,
    Math.min(50, selectedDish.baseRate + selectedScenario.rateDelta)
  );

  // Baseline is typical school waste rate (~24%)
  const baselineRate = 24;
  const avoidedPercent = baselineRate - finalRate;
  const avoidedKg = Math.max(
    0.5,
    Math.round((avoidedPercent / 100) * 120 * 10) / 10
  );
  const rescuedBowls = Math.round((avoidedKg * 1000) / 160);

  const handleSimulate = () => {
    setHasSimulated(true);
    addXp(10);
  };

  return (
    <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 text-white border-2 border-indigo-400/50 rounded-3xl p-5 sm:p-6 shadow-xl mb-6 relative overflow-hidden">
      {/* Background starlight */}
      <div className="absolute -top-10 -right-10 w-48 h-48 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-amber-400 animate-spin duration-3000" />
            <span className="text-xs font-bold tracking-widest text-amber-300 uppercase bg-amber-400/20 px-2.5 py-0.5 rounded-full border border-amber-400/30">
              時光機模擬器
            </span>
          </div>
          <h3 className="text-lg font-black text-white mt-1 flex items-center gap-1.5">
            <span>如果我是營養師小幫手：午餐時光機調調看！</span>
          </h3>
          <p className="text-xs text-slate-300 font-medium">
            挑選不同菜色與校園情境，親眼看看下一餐剩食率會如何神奇變化！
          </p>
        </div>
      </div>

      {/* Interactive Controls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Step 1: Dish Selection */}
        <div>
          <div className="text-xs font-bold text-amber-300 mb-2 flex items-center gap-1.5">
            <span>1. 挑選今日核心主菜</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DISH_OPTIONS.map((dish) => {
              const isSelected = selectedDish.id === dish.id;
              return (
                <button
                  key={dish.id}
                  onClick={() => {
                    setSelectedDish(dish);
                    handleSimulate();
                  }}
                  className={`flex items-center gap-2.5 p-3 rounded-2xl border-2 transition-all text-left ${
                    isSelected
                      ? "bg-amber-500/30 border-amber-400 text-white shadow-md scale-102"
                      : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20"
                  }`}
                >
                  <span className="text-2xl">{dish.emoji}</span>
                  <div>
                    <div className="text-xs font-black leading-tight text-white">
                      {dish.name}
                    </div>
                    <div className="text-[10px] text-amber-300/80 mt-0.5">
                      平均剩餘：{dish.baseRate}%
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 bg-white/5 rounded-xl p-2 border border-white/5">
            💬 <strong>主菜偵探便條：</strong> {selectedDish.note}
          </div>
        </div>

        {/* Step 2: Scenario Selection */}
        <div>
          <div className="text-xs font-bold text-amber-300 mb-2 flex items-center gap-1.5">
            <span>2. 疊加今日校園情境卡</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SCENARIOS.map((sc) => {
              const isSelected = selectedScenario.id === sc.id;
              return (
                <button
                  key={sc.id}
                  onClick={() => {
                    setSelectedScenario(sc);
                    handleSimulate();
                  }}
                  className={`flex items-center gap-2.5 p-3 rounded-2xl border-2 transition-all text-left ${
                    isSelected
                      ? "bg-indigo-500/40 border-indigo-400 text-white shadow-md scale-102"
                      : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20"
                  }`}
                >
                  <span className="text-2xl">{sc.emoji}</span>
                  <div>
                    <div className="text-xs font-black leading-tight text-white">
                      {sc.name}
                    </div>
                    <div className="text-[10px] text-indigo-300/80 mt-0.5">
                      食量影響：{sc.rateDelta > 0 ? `+${sc.rateDelta}%` : `${sc.rateDelta}%`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 bg-white/5 rounded-xl p-2 border border-white/5">
            🏃 <strong>情境背景：</strong> {selectedScenario.description}
          </div>
        </div>
      </div>

      {/* Real-time Time Machine Result Display */}
      <div className="bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-emerald-500/20 border-2 border-amber-400/60 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Mascot Verdict */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-400 text-slate-950 font-black text-3xl flex items-center justify-center shadow-lg shrink-0">
            {finalRate <= 10 ? "🎉" : finalRate <= 20 ? "🙂" : "😱"}
          </div>
          <div>
            <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              時光機預測成效
            </div>
            <h4 className="text-lg font-black text-white flex items-center gap-2">
              <span>預估剩食率：</span>
              <span
                className={`text-2xl font-black ${
                  finalRate <= 10
                    ? "text-emerald-400"
                    : finalRate <= 20
                      ? "text-amber-300"
                      : "text-red-400"
                }`}
              >
                {finalRate}%
              </span>
              <span className="text-xs font-normal text-slate-300">
                (平時基準 {baselineRate}%)
              </span>
            </h4>
            <p className="text-xs text-slate-200 mt-0.5">
              {finalRate <= 10
                ? "太神啦！全班幾乎清盤大豐收，廚房阿姨笑得合不攏嘴！"
                : finalRate <= 20
                  ? "表現良好！大家吃得飽又營養均衡，達到校園減廢標準！"
                  : "注意！這道菜大家比較不習慣，建議營養師調整烹調方式或份量！"}
            </p>
          </div>
        </div>

        {/* Right: Rescued Stats */}
        <div className="flex items-center gap-4 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 self-stretch md:self-auto justify-around">
          <div className="text-center">
            <div className="text-[10px] text-slate-400 font-semibold">少產廚餘</div>
            <div className="text-base font-black text-emerald-400">{avoidedKg} kg</div>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="text-center">
            <div className="text-[10px] text-slate-400 font-semibold">拯救白飯</div>
            <div className="text-base font-black text-amber-300">約 {rescuedBowls} 碗 🍚</div>
          </div>
        </div>
      </div>
    </div>
  );
}
