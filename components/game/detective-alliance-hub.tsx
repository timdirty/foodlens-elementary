"use client";

import React, { useState } from "react";
import {
  Flame,
  ChevronRight,
  Trophy,
  Utensils,
  MapPin,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { useGameMode } from "./game-mode-context";
import { DetectiveBadgeWall } from "./detective-badge-wall";

interface DetectiveAllianceHubProps {
  currentWasteKg?: number;
}

const ADVENTURE_STATIONS = [
  {
    id: 1,
    title: "第一站 · 清晨產地採收",
    tag: "產地溯源",
    icon: "🌱",
    role: "在地有機小農",
    location: "陽明山在地小農契作田",
    secretClue: "清晨現摘直送，不噴灑化學農藥！",
    story:
      "農夫阿伯天還沒亮就穿著雨鞋在田裡採收鮮嫩的小白菜。每一把青菜雖然偶爾有小菜青蟲咬過的小洞，但這可是天然純淨、友善大地的健康證明喔！",
    kidTakeaway: "多吃一口有機蔬菜，就是在保護臺灣的土地與小昆蟲生態！",
  },
  {
    id: 2,
    title: "第二站 · 校園熱氣蒸騰大廚房",
    tag: "少油少鹽",
    icon: "👩‍🍳",
    role: "午餐阿姨與營養師",
    location: "學校中央午餐廚房",
    secretClue: "三菜一湯少油少鹽，大鐵鍋熱騰騰翻炒！",
    story:
      "廚房阿姨推著比人還大的巨無霸大鐵鍋，拿著長長的鍋鏟全力翻炒！學校營養師在旁邊細心核對：今天維生素C與鈣質夠不夠？怎樣調味讓同學更愛吃青菜？",
    kidTakeaway: "每一勺飯菜都是廚房阿姨滿頭大汗煮出來的，滿滿都是關懷！",
  },
  {
    id: 3,
    title: "第三站 · 教室抬餐與打菜大作戰",
    tag: "班級分工",
    icon: "🍱",
    role: "午餐值日生團隊",
    location: "走廊與教室穿堂",
    secretClue: "戴好口罩圍裙，分菜均勻不爭搶！",
    story:
      "第四節下課鐘聲一響，今天輪值的值日生迅速戴上帽子、口罩與乾淨圍裙，到穿堂合力把熱呼呼的飯菜餐桶抬回教室。大家排好隊，值日生盡量盛得平均！",
    kidTakeaway: "不推擠、不挑食，大家輪流服務，教室氣氛最溫馨！",
  },
  {
    id: 4,
    title: "第四站 · 食光小偵探現場勘查",
    tag: "科技輔助",
    icon: "🕵️‍♂️",
    role: "食光小偵探小組",
    location: "教室後方觀察區",
    secretClue: "拍照初判 + 鷹眼人工精準校正！",
    story:
      "開動前與吃完後，偵探小組用平板記錄餐盤。AI 幫我們先找出排骨、白飯和青菜，我們再動手校正細節，確認每一筆線索都真實客觀！",
    kidTakeaway: "科技是我們的放大鏡，但真正的智慧與用心還是我們自己！",
  },
  {
    id: 5,
    title: "第五站 · 走廊秘密分流秤重基地",
    tag: "五源科學",
    icon: "⚖️",
    role: "衛生股長與量測小隊",
    location: "班級外走廊回收站",
    secretClue: "不可食骨頭單獨分出，廚房未盛出分開秤！",
    story:
      "倒廚餘時千萬不要混在一起倒！把不可吃的排骨骨頭與果皮單獨秤，沒盛出的乾淨飯菜分開秤。這樣一來，就知道到底是大家吃不完，還是廚房煮太多！",
    kidTakeaway: "分清楚剩餘的原因，才不會隨便指責偏食的同學！",
  },
  {
    id: 6,
    title: "第六站 · 綠色清運車合法出發",
    tag: "責任追蹤",
    icon: "🚛",
    role: "環保清運隊叔叔",
    location: "學校側門交接區",
    secretClue: "清運聯單核驗，絕不私倒造成環境污染！",
    story:
      "下午一點半，合格的清運車準時開到學校門口。清運司機跟午餐秘書老師雙方在平板上核簽電子聯單，每一公斤廚餘都有合法去向收據！",
    kidTakeaway: "誠實透明是科學精神，有憑有據才是好公民！",
  },
  {
    id: 7,
    title: "第七站 · 黑水虻分解與沃土重生",
    tag: "永續循環",
    icon: "🌳",
    role: "大自然生物循環專家",
    location: "有機生態園區 ➔ 校園菜圃",
    secretClue: "廚餘轉化為有機黑金，小菜圃又長出新生命！",
    story:
      "沒吃完的廚餘送往生物基地，由神奇的大自然小幫手『黑水虻』高效分解，轉化為富含有機質的肥沃土壤，再送回學校菜圃種出下一季的小番茄！",
    kidTakeaway: "生生不息，每一份食物都有它的起點、守護與新生！",
  },
];

export function DetectiveAllianceHub({
  currentWasteKg = 18.5,
}: DetectiveAllianceHubProps) {
  const { isGameMode, stats, badges } = useGameMode();
  const [activeTab, setActiveTab] = useState<"rank" | "impact" | "stations">(
    "rank",
  );
  const [showBadgeWall, setShowBadgeWall] = useState(false);
  const [currentStationIndex, setCurrentStationIndex] = useState(0);

  // Daily bite simulation
  const [perStudentBiteG, setPerStudentBiteG] = useState(15);
  const studentCount = 850; // Standard Taipei elementary school size

  const currentLevelMax =
    stats.level === 1
      ? 100
      : stats.level === 2
        ? 300
        : stats.level === 3
          ? 600
          : 1000;
  const currentLevelBase =
    stats.level === 1
      ? 0
      : stats.level === 2
        ? 100
        : stats.level === 3
          ? 300
          : 600;
  const progressPercent = Math.min(
    100,
    Math.max(
      0,
      ((stats.xp - currentLevelBase) / (currentLevelMax - currentLevelBase)) *
        100,
    ),
  );

  const unlockedBadgesCount = badges.filter((b) => b.unlocked).length;

  // Real world tangible equivalents
  const rescuedBowls = Math.round((currentWasteKg * 1000) / 160);
  const rescuedBento = Math.round((currentWasteKg * 1000) / 400);
  const avoidedCo2Kg = (currentWasteKg * 2.5).toFixed(1);

  // Simulation calculations
  const simSavedDailyKg = ((perStudentBiteG * studentCount) / 1000).toFixed(1);
  const simSavedBowls = Math.round((Number(simSavedDailyKg) * 1000) / 160);
  const simSavedYearlyKg = (Number(simSavedDailyKg) * 200).toFixed(0); // 200 school days

  const currentStation = ADVENTURE_STATIONS[currentStationIndex];

  return (
    <section className="card p-5 sm:p-6 mb-8 bg-[#fffefa] border border-[var(--line)] shadow-xs rounded-2xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--line)] pb-4 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#7a4f10] bg-[#fdf2dc] px-2.5 py-0.5 rounded border border-[#ebd9b5]">
              國小跨域學習 · 食光偵探同盟
            </span>
            {isGameMode && (
              <span className="text-xs font-semibold text-[#527066]">
                全班探案連勝中 · 第 {stats.streakDays} 天
              </span>
            )}
          </div>
          <h2 className="text-lg sm:text-xl font-black text-[var(--ink)] mt-1.5 tracking-tight">
            把每一份午餐的微小改變，化為小學生的破案探險
          </h2>
          <p className="text-xs sm:text-sm text-[var(--ink-soft)] font-medium mt-0.5">
            結合榮譽階級、日常等價物換算與校園 7
            站旅程，讓數據成為守護惜食的溫暖證據。
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 bg-[#f6faf6] border border-[#dcecdf] p-1 rounded-xl shrink-0 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab("rank")}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
              activeTab === "rank"
                ? "bg-[#fff] text-[#174b36] shadow-xs font-black"
                : "text-[#527066] hover:text-[#18332a]"
            }`}
          >
            🎖️ 偵探榮譽
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("impact")}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
              activeTab === "impact"
                ? "bg-[#fff] text-[#174b36] shadow-xs font-black"
                : "text-[#527066] hover:text-[#18332a]"
            }`}
          >
            🍱 惜食等價物
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stations")}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
              activeTab === "stations"
                ? "bg-[#fff] text-[#174b36] shadow-xs font-black"
                : "text-[#527066] hover:text-[#18332a]"
            }`}
          >
            🗺️ 校園 7 站旅程
          </button>
        </div>
      </div>

      {/* Tab 1: Detective Rank & XP */}
      {activeTab === "rank" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-center">
          {/* Rank & Level */}
          <div className="lg:col-span-2 flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-[#fffdf8] border border-[#ebd9b5] rounded-xl p-4">
            <div className="w-14 h-14 rounded-2xl bg-[#fbf3e4] border border-[#d99432]/40 text-[#d99432] flex items-center justify-center text-3xl shrink-0 shadow-xs">
              {stats.level === 1
                ? "🥉"
                : stats.level === 2
                  ? "🥈"
                  : stats.level === 3
                    ? "🥇"
                    : "👑"}
            </div>
            <div className="flex-1 w-full">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#7a4f10]">
                  當前階級：{stats.rankTitle}
                </span>
                <span className="text-xs font-bold text-[#7a4f10]">
                  Lv.{stats.level} · {stats.xp} / {currentLevelMax} XP
                </span>
              </div>
              <div className="w-full h-2 bg-[#ebd9b5]/60 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-[#d99432] rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--ink-soft)] font-medium mt-2">
                💡 <strong>升級密技：</strong>完成一次餐盤記錄或校正即可獲得
                10~15 XP；班級守護連續 5 天清盤可獲勳章！
              </p>
            </div>
          </div>

          {/* Quick Metrics & Badges */}
          <div className="flex sm:grid sm:grid-cols-2 lg:flex lg:flex-col gap-2.5">
            <div className="flex-1 flex items-center justify-between p-3 bg-[#f6faf6] border border-[#dcecdf] rounded-xl">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-bold text-[var(--ink)]">
                  全班守護天數
                </span>
              </div>
              <strong className="text-sm text-[var(--green-dark)] font-black">
                {stats.streakDays} 天
              </strong>
            </div>

            <button
              type="button"
              onClick={() => setShowBadgeWall(true)}
              className="flex-1 flex items-center justify-between p-3 bg-[#fffdf5] border border-[#e6c88f] hover:bg-[#faeed7] rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-[#d99432]" />
                <span className="text-xs font-bold text-[#7a4f10]">
                  偵探徽章牆 ({unlockedBadgesCount}/{badges.length})
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#7a4f10]" />
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Food Rescue Tangible Equivalence */}
      {activeTab === "impact" && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-[#fffdf8] border border-[#ebd9b5] rounded-xl p-4 flex items-center gap-3">
              <span className="text-3xl">🍚</span>
              <div>
                <div className="text-[11px] font-bold text-[#7a4f10]">
                  已拯救熱騰騰白飯
                </div>
                <div className="text-xl font-black text-[var(--ink)]">
                  約 {rescuedBowls} 碗
                </div>
                <div className="text-[10px] text-[var(--ink-soft)]">
                  足供全五年級飽餐一頓
                </div>
              </div>
            </div>

            <div className="bg-[#f6faf6] border border-[#dcecdf] rounded-xl p-4 flex items-center gap-3">
              <span className="text-3xl">🍱</span>
              <div>
                <div className="text-[11px] font-bold text-[var(--green-dark)]">
                  完整營養便當
                </div>
                <div className="text-xl font-black text-[var(--ink)]">
                  約 {rescuedBento} 份
                </div>
                <div className="text-[10px] text-[var(--ink-soft)]">
                  減少廚餘直接化為友善心意
                </div>
              </div>
            </div>

            <div className="bg-[#fbfaf5] border border-[var(--line)] rounded-xl p-4 flex items-center gap-3">
              <span className="text-3xl">🌿</span>
              <div>
                <div className="text-[11px] font-bold text-[#527066]">
                  少產生的碳排放
                </div>
                <div className="text-xl font-black text-[var(--ink)]">
                  約 {avoidedCo2Kg} kg
                </div>
                <div className="text-[10px] text-[var(--ink-soft)]">
                  每公斤廚餘相當於 2.5 kg CO2e
                </div>
              </div>
            </div>
          </div>

          {/* Bite Size Interactive Simulator */}
          <div className="bg-[#fbfaf5] border border-[var(--line)] rounded-xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Utensils className="w-4 h-4 text-[var(--green)]" />
                <strong className="text-xs font-bold text-[var(--ink)]">
                  校園小實踐：「如果每人每一餐多吃一口（約 15g）？」
                </strong>
              </div>
              <span className="text-xs font-bold text-[var(--green-dark)] bg-[#edf5ee] px-2 py-0.5 rounded">
                目前試算：每位同學多吃 {perStudentBiteG} 克
              </span>
            </div>

            <div className="flex items-center gap-3 mb-2">
              <input
                type="range"
                min={5}
                max={30}
                step={5}
                value={perStudentBiteG}
                onChange={(e) => setPerStudentBiteG(Number(e.target.value))}
                className="w-full accent-[var(--green)] cursor-pointer"
                aria-label="每位同學一口克數"
              />
            </div>

            <div className="text-xs text-[var(--ink-soft)] flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                全校 {studentCount} 位同學一天可少浪費{" "}
                <strong>{simSavedDailyKg} kg</strong>
              </span>
              <span>
                相當於每天少浪費 <strong>{simSavedBowls} 碗白飯</strong>
              </span>
              <span>
                一年 200 個供餐日累計可守護{" "}
                <strong>{simSavedYearlyKg} kg</strong> 食物！
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Campus Adventure 7 Stations */}
      {activeTab === "stations" && (
        <div>
          {/* Station Stepper Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-none">
            {ADVENTURE_STATIONS.map((st, idx) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setCurrentStationIndex(idx)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg shrink-0 flex items-center gap-1.5 transition-all ${
                  currentStationIndex === idx
                    ? "bg-[#327052] text-white shadow-xs"
                    : "bg-[#edf5ee] text-[#174b36] hover:bg-[#dcecdf]"
                }`}
              >
                <span>{st.icon}</span>
                <span>第 {st.id} 站</span>
              </button>
            ))}
          </div>

          {/* Active Station Card */}
          <div className="bg-[#fffdf8] border border-[#ebd9b5] rounded-xl p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#ebd9b5]/80 pb-3 mb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{currentStation.icon}</span>
                <div>
                  <div className="text-xs font-bold text-[#7a4f10] flex items-center gap-2">
                    <span>{currentStation.role}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {currentStation.location}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-[var(--ink)] mt-0.5">
                    {currentStation.title}
                  </h3>
                </div>
              </div>
              <span className="text-[11px] bg-[#fdf2dc] text-[#7a4f10] border border-[#ebd9b5] font-bold px-2.5 py-1 rounded-md self-start sm:self-auto">
                🔎 線索：{currentStation.secretClue}
              </span>
            </div>

            <p className="text-xs sm:text-sm text-[var(--ink)] leading-relaxed mb-3">
              {currentStation.story}
            </p>

            <div className="bg-[#fff] border border-[#ebd9b5] rounded-lg p-2.5 flex items-center gap-2 text-xs font-bold text-[#174b36]">
              <CheckCircle2 className="w-4 h-4 text-[var(--green)] shrink-0" />
              <span>小偵探生活實踐：{currentStation.kidTakeaway}</span>
            </div>

            {/* Stepper Buttons */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#ebd9b5]/60">
              <button
                type="button"
                disabled={currentStationIndex === 0}
                onClick={() =>
                  setCurrentStationIndex((prev) => Math.max(0, prev - 1))
                }
                className="text-xs font-bold text-[var(--ink-soft)] disabled:opacity-30 hover:text-[var(--ink)] transition-colors"
              >
                ← 上一站
              </button>
              <span className="text-xs font-semibold text-[var(--ink-soft)]">
                {currentStationIndex + 1} / {ADVENTURE_STATIONS.length}
              </span>
              <button
                type="button"
                disabled={currentStationIndex === ADVENTURE_STATIONS.length - 1}
                onClick={() =>
                  setCurrentStationIndex((prev) =>
                    Math.min(ADVENTURE_STATIONS.length - 1, prev + 1),
                  )
                }
                className="text-xs font-bold text-[var(--green)] disabled:opacity-30 hover:underline flex items-center gap-1"
              >
                <span>下一站</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showBadgeWall && (
        <DetectiveBadgeWall onClose={() => setShowBadgeWall(false)} />
      )}
    </section>
  );
}
