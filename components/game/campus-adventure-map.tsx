"use client";

import React, { useState } from "react";
import { Sparkles, ArrowRight, CheckCircle2, ChevronRight, Compass } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface Station {
  id: number;
  title: string;
  tag: string;
  icon: string;
  role: string;
  location: string;
  secretClue: string;
  story: string;
  kidTakeaway: string;
}

const ADVENTURE_STATIONS: Station[] = [
  {
    id: 1,
    title: "第一站 · 清晨產地採收",
    tag: "食材溯源",
    icon: "🌱",
    role: "在地有機小農",
    location: "陽明山在地菜園",
    secretClue: "有機青菜清晨現摘，直送校園！",
    story: "農夫阿伯天還沒亮就穿著雨鞋在田裡採收鮮嫩的小白菜。每一把青菜都沒有噴灑農藥，雖然菜葉偶爾被小毛毛蟲咬了個小洞，但這可是最健康純淨的證明喔！",
    kidTakeaway: "多吃一口有機蔬菜，就是在保護臺灣的土地與小昆蟲！",
  },
  {
    id: 2,
    title: "第二站 · 校園魔法大廚房",
    tag: "營養設計",
    icon: "👩‍🍳",
    role: "午餐阿姨與營養師",
    location: "中央蒸氣大廚房",
    secretClue: "三菜一湯少油少鹽，熱氣騰騰！",
    story: "廚房阿姨推著比人還大的巨無霸大鐵鍋，拿著像船槳一樣的大鍋鏟翻炒！營養師在一旁細心計算：今天維生素C夠不夠？鈣質能不能讓大家長高高？",
    kidTakeaway: "每一勺飯菜都是廚房阿姨流著汗煮出來的，滿滿都是愛心！",
  },
  {
    id: 3,
    title: "第三站 · 教室抬餐大作戰",
    tag: "班級分工",
    icon: "🍱",
    role: "午餐值日生",
    location: "走廊與教室前門",
    secretClue: "四人一組戴好口罩，安全第一！",
    story: "第四節下課鐘聲一響，今天輪值的值日生戴上帽子、口罩與圍裙，像特種部隊一樣到穿堂合力把熱呼呼的餐桶抬回教室，大家乖乖洗手排隊打菜！",
    kidTakeaway: "不推擠、不挑食，互相幫忙盛飯菜最有同學愛！",
  },
  {
    id: 4,
    title: "第四站 · 食光偵探現場勘查",
    tag: "餐盤採樣",
    icon: "🕵️‍♂️",
    role: "食光小偵探小組",
    location: "教室後方拍照區",
    secretClue: "拍照初判 + 鷹眼手動校正！",
    story: "開動前與吃完後，偵探小隊拿起平板輕輕一拍！AI 幫我們把餐盤裡的排骨、白飯和青菜辨識出來，我們再用手指點一點『鷹眼校正』，確認每一筆線索都真實可信！",
    kidTakeaway: "科技是我們的放大鏡，但真正的聰明眼睛還是我們自己！",
  },
  {
    id: 5,
    title: "第五站 · 秘密秤重基地",
    tag: "五源分流",
    icon: "⚖️",
    role: "環境衛生股長",
    location: "走廊分類回收桶",
    secretClue: "骨頭果皮分開，未發出飯菜不混雜！",
    story: "倒廚餘時可不是呼嚕全倒進去！我們把不可吃的骨頭果皮分出來，沒動過的乾淨白飯分一桶，吃剩的菜分一桶。這樣一秤，就知道是大家吃不完、還是廚房煮太多！",
    kidTakeaway: "分清楚為什麼剩下，才不會冤枉了沒做錯事的同學！",
  },
  {
    id: 6,
    title: "第六站 · 綠色清運卡車出發",
    tag: "責任追蹤",
    icon: "🚛",
    role: "清運環保隊叔叔",
    location: "校門口側門交接處",
    secretClue: "電子收據核驗，絕不偷倒水溝！",
    story: "環保清運車準時在下午一點半抵達校門口。司機叔叔跟學校午餐秘書老師雙方簽名核對，每一桶廚餘都有合法去向收據，保證送去合法的再利用場！",
    kidTakeaway: "有憑有據才是好國民，透明誠實比考一百分還重要！",
  },
  {
    id: 7,
    title: "第七站 · 黑水虻與沃土重生",
    tag: "永續循環",
    icon: "🌳",
    role: "大自然分解魔法師",
    location: "生物循環園區 ➔ 校園菜圃",
    secretClue: "廚餘變沃土，再種出一顆大甘薯！",
    story: "沒吃完的廚餘送到循環基地，神奇的大自然小幫手『黑水虻』大口大口吃下，最後轉化為富含有機質的肥沃土壤，再送回學校的小菜圃當肥料，種出下一季的小番茄！",
    kidTakeaway: "生命生生不息，每一份食物都有它的終點與新生！",
  },
];

export function CampusAdventureMap() {
  const { isGameMode } = useGameMode();
  const [selectedStation, setSelectedStation] = useState<Station>(ADVENTURE_STATIONS[3]);

  if (!isGameMode) return null;

  return (
    <div className="bg-gradient-to-br from-amber-50 via-white to-orange-50 border-2 border-amber-300 rounded-3xl p-5 sm:p-6 shadow-sm mb-6 relative overflow-hidden">
      {/* Badge Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 border-b border-amber-200/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🗺️</span>
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <span>今日午餐探案地圖 · 走訪全校食物奇幻旅程</span>
              <span className="text-[10px] bg-amber-400 text-amber-950 font-bold px-2 py-0.5 rounded-full">
                國小組特色導覽
              </span>
            </h3>
            <p className="text-xs text-slate-600 font-medium">
              點擊地圖上的 7 個探案據點，跟著值日生、廚房阿姨和小農一起破解剩食謎題！
            </p>
          </div>
        </div>
      </div>

      {/* Horizontal Interactive Steps Ribbon */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-4 scrollbar-none snap-x">
        {ADVENTURE_STATIONS.map((station) => {
          const isSelected = selectedStation.id === station.id;
          return (
            <button
              key={station.id}
              onClick={() => setSelectedStation(station)}
              className={`flex items-center gap-2 shrink-0 px-3.5 py-2 rounded-2xl border-2 transition-all snap-start ${
                isSelected
                  ? "bg-amber-500 border-amber-600 text-white shadow-md scale-102"
                  : "bg-white border-amber-200 text-slate-700 hover:border-amber-400 hover:bg-amber-50/50"
              }`}
            >
              <span className="text-xl">{station.icon}</span>
              <div className="text-left">
                <div
                  className={`text-[10px] font-bold ${
                    isSelected ? "text-amber-100" : "text-amber-700"
                  }`}
                >
                  第 {station.id} 站
                </div>
                <div className="text-xs font-black leading-tight whitespace-nowrap">
                  {station.tag}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Active Station Detail Card (Hand-drawn Notebook Style) */}
      <div className="bg-white border-2 border-dashed border-amber-400 rounded-2xl p-4 sm:p-5 shadow-xs relative">
        {/* Cute Corner Stamp */}
        <div className="absolute top-3 right-3 bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-black px-2.5 py-1 rounded-full flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-600" />
          <span>食光偵探特報 #{selectedStation.id}</span>
        </div>

        <div className="flex flex-col md:flex-row items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-100 border-2 border-amber-300 flex items-center justify-center text-3xl shrink-0 shadow-inner">
            {selectedStation.icon}
          </div>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h4 className="text-base font-black text-slate-900">
                {selectedStation.title}
              </h4>
              <span className="text-xs font-bold text-slate-500">
                地點：{selectedStation.location}
              </span>
              <span className="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                主角：{selectedStation.role}
              </span>
            </div>

            <p className="text-xs text-slate-700 font-medium leading-relaxed mb-3">
              {selectedStation.story}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100">
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-950">
                <strong className="font-black text-amber-800 flex items-center gap-1 mb-0.5">
                  <span>🔍 現場偵探線索：</span>
                </strong>
                <span>{selectedStation.secretClue}</span>
              </div>

              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-2.5 text-xs text-emerald-950">
                <strong className="font-black text-emerald-800 flex items-center gap-1 mb-0.5">
                  <span>💡 小學生生活省思：</span>
                </strong>
                <span>{selectedStation.kidTakeaway}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
