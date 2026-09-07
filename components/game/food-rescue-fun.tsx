"use client";

import React, { useState } from "react";
import { Sparkles, Utensils, TreeDeciduous, Users, Sliders } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface FoodRescueFunProps {
  currentWasteKg?: number;
}

export function FoodRescueFun({ currentWasteKg = 18.5 }: FoodRescueFunProps) {
  const { isGameMode } = useGameMode();
  const [perStudentBiteG, setPerStudentBiteG] = useState<number>(15);
  const [studentCount] = useState<number>(850); // Representative Taipei school

  if (!isGameMode) return null;

  // Conversion rates (Taiwan school lunch standard estimation)
  // 1 bowl of cooked rice ≈ 160g
  // 1 full bento box ≈ 400g
  // 1 pork chop ≈ 120g
  // 1 kg food waste ≈ 2.5 kg CO2e, 1 mature tree absorbs ~0.06 kg CO2e per day (~22 kg/year)
  const rescuedBowls = Math.round((currentWasteKg * 1000) / 160);
  const rescuedBento = Math.round((currentWasteKg * 1000) / 400);
  const rescuedTrees = Math.round(((currentWasteKg * 2.5) / 0.06) * 0.1); // Tree equivalent

  // Interactive slider simulation
  const simulatedDailySavedKg = ((perStudentBiteG * studentCount) / 1000).toFixed(1);
  const simulatedSavedBowls = Math.round(
    (Number(simulatedDailySavedKg) * 1000) / 160
  );
  const simulatedCo2Kg = (Number(simulatedDailySavedKg) * 2.5).toFixed(1);

  return (
    <div className="bg-white border-2 border-emerald-200 rounded-2xl p-5 shadow-xs mb-6 overflow-hidden relative">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🌱</span>
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center gap-1.5">
              <span>食光拯救實錄 · 趣味等價換算</span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                直觀影響力
              </span>
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              將冰冷的公斤數，轉化為看得見、有溫度的生活等價物！
            </p>
          </div>
        </div>
      </div>

      {/* 3 Tangible Equivalent Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {/* Card 1: Rice bowls */}
        <div className="bg-gradient-to-br from-amber-50 to-amber-100/60 border border-amber-200 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white shadow-xs flex items-center justify-center text-2xl shrink-0">
            🍚
          </div>
          <div>
            <div className="text-[11px] font-semibold text-amber-800">
              拯救熱騰騰白飯
            </div>
            <div className="text-xl font-black text-amber-950">
              約 {rescuedBowls} 碗
            </div>
            <div className="text-[10px] text-amber-700 font-medium">
              足以提供 1 個年級吃飽
            </div>
          </div>
        </div>

        {/* Card 2: Bento boxes */}
        <div className="bg-gradient-to-br from-orange-50 to-orange-100/60 border border-orange-200 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white shadow-xs flex items-center justify-center text-2xl shrink-0">
            🍱
          </div>
          <div>
            <div className="text-[11px] font-semibold text-orange-800">
              完整營養便當
            </div>
            <div className="text-xl font-black text-orange-950">
              約 {rescuedBento} 份
            </div>
            <div className="text-[10px] text-orange-700 font-medium">
              廚餘減量化為食物善意
            </div>
          </div>
        </div>

        {/* Card 3: Trees Carbon */}
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/60 border border-emerald-200 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white shadow-xs flex items-center justify-center text-2xl shrink-0">
            🌳
          </div>
          <div>
            <div className="text-[11px] font-semibold text-emerald-800">
              校園減碳成效
            </div>
            <div className="text-xl font-black text-emerald-950">
              相當於 {rescuedTrees} 棵樹
            </div>
            <div className="text-[10px] text-emerald-700 font-medium">
              少排 {(currentWasteKg * 2.5).toFixed(1)} kg 溫室氣體
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Simulation Slider */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Sliders className="w-3.5 h-3.5 text-emerald-600" />
            <span>互動實驗室：如果全校 {studentCount} 位同學，每人午餐少剩一口飯？</span>
          </div>
          <div className="text-xs font-black text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full self-start sm:self-auto">
            每人少剩：{perStudentBiteG} 公克
          </div>
        </div>

        <input
          type="range"
          min="5"
          max="35"
          step="5"
          value={perStudentBiteG}
          onChange={(e) => setPerStudentBiteG(Number(e.target.value))}
          className="w-full accent-emerald-600 cursor-pointer h-2 bg-slate-200 rounded-lg mb-3"
          aria-label="每人少剩一口飯公克數滑桿"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-600 pt-1 border-t border-slate-200">
          <span>
            全校一天可減少剩食：<strong className="text-slate-900 font-black">{simulatedDailySavedKg} kg</strong>
          </span>
          <span>
            相當於拯救：<strong className="text-amber-700 font-black">{simulatedSavedBowls} 碗飯</strong>
          </span>
          <span>
            日減少碳排放：<strong className="text-emerald-700 font-black">{simulatedCo2Kg} kg CO2e</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
