"use client";

import React, { useState } from "react";
import { FlaskConical, Info } from "lucide-react";
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
    note: "全校人氣排名前茅！白肉吃光率高達 95%，注意骨頭須獨立分流秤重。",
  },
  {
    id: "pork",
    name: "經典鐵路大排骨",
    emoji: "🥩",
    baseRate: 8,
    note: "香味濃郁！值日生打菜迅速，但份量若太大可能造成部分小胃口同學負擔。",
  },
  {
    id: "curry",
    name: "日式甘口咖哩豬",
    emoji: "🍛",
    baseRate: 4,
    note: "白飯好幫手！只要遇到咖哩日，班級飯桶多數會見底，剩食率極低。",
  },
  {
    id: "bitter",
    name: "家常蒜蓉炒苦瓜",
    emoji: "🥒",
    baseRate: 38,
    note: "挑食心魔考驗！國小生對苦味敏感，若加入小魚乾或甘口調味，接受度大幅提升。",
  },
];

const SCENARIOS: CampusScenario[] = [
  {
    id: "dodgeball",
    name: "下午有全校躲避球賽",
    emoji: "🏃",
    rateDelta: -6,
    description: "運動量爆棚，大家的肚子咕嚕叫，食量明顯增加！",
  },
  {
    id: "exam-done",
    name: "剛剛考完期中考",
    emoji: "🥳",
    rateDelta: -4,
    description: "緊繃心情完全放鬆，食慾大開，班級打菜氣氛熱絡。",
  },
  {
    id: "cold-weather",
    name: "寒流來襲氣溫 12 度",
    emoji: "❄️",
    rateDelta: -3,
    description: "天冷需要熱量禦寒，熱騰騰的飯菜與熱湯最受歡迎。",
  },
  {
    id: "normal",
    name: "一般平常校園上課日",
    emoji: "📚",
    rateDelta: 0,
    description: "按照作息規律打菜用餐，反映日常平均基準。",
  },
];

export function LunchTimeMachine() {
  const { isGameMode, addXp } = useGameMode();
  const [selectedDish, setSelectedDish] = useState<MainDish>(DISH_OPTIONS[2]); // Curry
  const [selectedScenario, setSelectedScenario] = useState<CampusScenario>(
    SCENARIOS[0],
  ); // Dodgeball

  if (!isGameMode) return null;

  // Calculate final simulated leftover rate
  const finalRate = Math.max(
    2,
    Math.min(50, selectedDish.baseRate + selectedScenario.rateDelta),
  );

  // Baseline is typical school waste rate (~24%)
  const baselineRate = 24;
  const avoidedPercent = baselineRate - finalRate;
  const avoidedKg = Math.max(
    0.5,
    Math.round((avoidedPercent / 100) * 120 * 10) / 10,
  );
  const rescuedBowls = Math.round((avoidedKg * 1000) / 160);

  const handleSimulate = () => {
    addXp(10);
  };

  return (
    <section className="card p-5 sm:p-6 mb-8 bg-[#fffefa] border border-[var(--line)] shadow-xs rounded-2xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--line)] pb-4 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-[var(--green)]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#174b36] bg-[#edf5ee] px-2.5 py-0.5 rounded border border-[#bdd8c4]">
              國小跨域探究 · 午餐配方實驗桌
            </span>
          </div>
          <h3 className="text-lg font-black text-[var(--ink)] mt-1 tracking-tight">
            如果我是小小營養師：情境模擬調調看
          </h3>
          <p className="text-xs text-[var(--ink-soft)] font-medium">
            挑選不同菜色與校園情境，觀察剩食率與班級備餐量的科學變化。
          </p>
        </div>
      </div>

      {/* Interactive Controls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Step 1: Dish Selection */}
        <div>
          <div className="text-xs font-bold text-[#7a4f10] mb-2 flex items-center gap-1.5">
            <span>1. 挑選今日核心主菜</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {DISH_OPTIONS.map((dish) => {
              const isSelected = selectedDish.id === dish.id;
              return (
                <button
                  key={dish.id}
                  type="button"
                  onClick={() => {
                    setSelectedDish(dish);
                    handleSimulate();
                  }}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? "bg-[#fffdf5] border-[#d99432] text-[var(--ink)] shadow-xs font-bold"
                      : "bg-[#fff] border-[var(--line)] text-[var(--ink-soft)] hover:bg-[#fbfaf5] hover:border-[#bdd8c4]"
                  }`}
                >
                  <span className="text-2xl">{dish.emoji}</span>
                  <div>
                    <div className="text-xs font-black leading-tight text-[var(--ink)]">
                      {dish.name}
                    </div>
                    <div className="text-[10px] text-[#7a4f10] mt-0.5 font-medium">
                      預估剩餘：{dish.baseRate}%
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 text-[11px] text-[var(--ink-soft)] bg-[#fbfaf5] rounded-xl p-2.5 border border-[var(--line)] flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 text-[var(--green)] shrink-0 mt-0.5" />
            <span>
              <strong>食材探究便條：</strong> {selectedDish.note}
            </span>
          </div>
        </div>

        {/* Step 2: Scenario Selection */}
        <div>
          <div className="text-xs font-bold text-[var(--green-dark)] mb-2 flex items-center gap-1.5">
            <span>2. 疊加今日校園情境卡</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {SCENARIOS.map((sc) => {
              const isSelected = selectedScenario.id === sc.id;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => {
                    setSelectedScenario(sc);
                    handleSimulate();
                  }}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? "bg-[#edf5ee] border-[var(--green)] text-[var(--ink)] shadow-xs font-bold"
                      : "bg-[#fff] border-[var(--line)] text-[var(--ink-soft)] hover:bg-[#fbfaf5] hover:border-[#bdd8c4]"
                  }`}
                >
                  <span className="text-2xl">{sc.emoji}</span>
                  <div>
                    <div className="text-xs font-black leading-tight text-[var(--ink)]">
                      {sc.name}
                    </div>
                    <div className="text-[10px] text-[var(--green-dark)] mt-0.5 font-medium">
                      食量微調：
                      {sc.rateDelta > 0
                        ? `+${sc.rateDelta}%`
                        : `${sc.rateDelta}%`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 text-[11px] text-[var(--ink-soft)] bg-[#fbfaf5] rounded-xl p-2.5 border border-[var(--line)] flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 text-[var(--green)] shrink-0 mt-0.5" />
            <span>
              <strong>情境生活觀察：</strong> {selectedScenario.description}
            </span>
          </div>
        </div>
      </div>

      {/* Simulation Result Board */}
      <div className="bg-[#f6faf6] border border-[#bdd8c4] rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-[#fff] border border-[#bdd8c4] flex items-center justify-center text-2xl shadow-xs shrink-0">
            📊
          </div>
          <div>
            <div className="text-[11px] font-bold text-[var(--green-dark)]">
              配方試算加權剩食率
            </div>
            <div className="text-2xl font-black text-[var(--green-dark)] flex items-center gap-2">
              <span>{finalRate}%</span>
              <span className="text-xs font-bold text-[#18332a] bg-[#fff] px-2 py-0.5 rounded border border-[#bdd8c4]">
                基準 24% ➔ 相對改善{" "}
                {avoidedPercent > 0
                  ? `-${avoidedPercent}%`
                  : `+${Math.abs(avoidedPercent)}%`}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-bold text-[var(--ink)] border-t sm:border-t-0 pt-3 sm:pt-0 border-[#bdd8c4]/60 w-full sm:w-auto justify-between sm:justify-end">
          <div>
            <span className="text-[10px] text-[var(--ink-soft)] block">
              全校預估少產生
            </span>
            <strong className="text-base text-[var(--ink)]">
              {avoidedKg} kg
            </strong>{" "}
            剩食
          </div>
          <div className="text-right">
            <span className="text-[10px] text-[var(--ink-soft)] block">
              相當於守護
            </span>
            <strong className="text-base text-[#174b36]">
              約 {rescuedBowls} 碗
            </strong>{" "}
            白飯 🍚
          </div>
        </div>
      </div>
    </section>
  );
}
