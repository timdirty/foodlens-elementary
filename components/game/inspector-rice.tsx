"use client";

import React, { useState } from "react";
import { X, ChevronUp } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface QuoteItem {
  tag: string;
  text: string;
}

const ELEMENTARY_LUNCH_QUOTES: QuoteItem[] = [
  {
    tag: "午餐值日生",
    text: "今天抬餐桶的值日生辛苦了！打菜時稍微均勻一點，大家都吃得飽飽的～",
  },
  {
    tag: "有機小白菜",
    text: "陽明山有機小農清晨現摘的青菜，雖然有小昆蟲咬過的小洞，但代表最純淨健康喔！",
  },
  {
    tag: "不可食骨頭",
    text: "照燒排骨太好吃啦！記得把雞骨頭與果皮分開秤重，才不會把不可食部分算成浪費喔！",
  },
  {
    tag: "暖心同理",
    text: "今天有同學吃比較慢嗎？不要催促或嘲笑，給彼此充足時間細嚼慢嚥最健康！",
  },
  {
    tag: "科學探案",
    text: "如果三色豆剩比較多，我們用真實數據給營養師建議，下次換成甜玉米炒蛋！",
  },
  {
    tag: "黑水虻沃土",
    text: "不可避免的廚餘，會送去生物循環基地分解，轉化為校園小菜圃的有機沃土！",
  },
];

export function InspectorRice() {
  const { isGameMode } = useGameMode();
  const [minimized, setMinimized] = useState(true); // Default minimized to never block user view
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [showBubble, setShowBubble] = useState(false); // Only show when user clicks/taps
  const [isHovered, setIsHovered] = useState(false);

  if (!isGameMode) return null;

  const currentQuote = ELEMENTARY_LUNCH_QUOTES[quoteIndex];

  return (
    <aside
      aria-label="米寶偵探助手"
      className="rice-detective-dock select-none transition-all duration-300"
    >
      {/* Speech Bubble (Only shown when user interacts) */}
      {!minimized && showBubble && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 max-w-xs bg-[#fffdfa] text-slate-800 border border-[#e6c88f] rounded-2xl p-3.5 shadow-lg relative animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <button
            onClick={() => setShowBubble(false)}
            aria-label="關閉米寶氣泡提示"
            className="absolute -top-2 -right-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full p-1 shadow-xs transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-start gap-2.5">
            <span className="text-xl shrink-0">🕵️‍♂️</span>
            <div>
              <div className="text-xs font-bold text-[#7a4f10] flex items-center gap-1.5 mb-1">
                <span>米寶偵探</span>
                <span className="text-[10px] bg-[#fdf2dc] text-[#7a4f10] border border-[#ecd5aa] px-1.5 py-0.5 rounded font-bold">
                  {currentQuote.tag}
                </span>
              </div>
              <p className="text-xs font-medium leading-relaxed text-[#2c4035]">
                {currentQuote.text}
              </p>
            </div>
          </div>
          {/* Bubble Tail */}
          <div className="absolute -bottom-2 right-6 w-3 h-3 bg-[#fffdfa] border-r border-b border-[#e6c88f] rotate-45" />
        </div>
      )}

      {/* Mascot Character Avatar */}
      <div className="flex items-center gap-2">
        {minimized ? (
          <button
            onClick={() => {
              setMinimized(false);
              setShowBubble(true);
              setQuoteIndex(
                (prev) => (prev + 1) % ELEMENTARY_LUNCH_QUOTES.length,
              );
            }}
            className="bg-[#fffdf8] hover:bg-[#faeed7] text-[#4f330b] font-bold px-3 py-1.5 rounded-full shadow-md border border-[#d4b276] flex items-center gap-1.5 text-xs transition-transform hover:scale-105 active:scale-95"
            title="點擊召喚米寶偵探"
          >
            <span className="text-base">🍚</span>
            <span>米寶小幫手</span>
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div
            className="group relative cursor-pointer"
            onClick={() => {
              setQuoteIndex(
                (prev) => (prev + 1) % ELEMENTARY_LUNCH_QUOTES.length,
              );
              setShowBubble((prev) => !prev);
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            title="點擊聽米寶說校園午餐日常！"
          >
            {/* Subtle Aura */}
            <div className="absolute -inset-1 bg-[#d99432]/20 rounded-full blur-xs group-hover:opacity-75 transition duration-300" />

            {/* Rice Detective SVG Illustration */}
            <div className="relative w-14 h-14 bg-[#fffdf5] border-2 border-[#d4b276] rounded-full shadow-md flex items-center justify-center overflow-hidden transition-transform duration-300 group-hover:scale-105 active:scale-95">
              <svg viewBox="0 0 100 100" className="w-12 h-12" fill="none">
                {/* Rice Grain Body */}
                <ellipse
                  cx="50"
                  cy="56"
                  rx="26"
                  ry="32"
                  fill="#FFFFFF"
                  stroke="#D99432"
                  strokeWidth="2.2"
                />
                <path
                  d="M48 24C32 27 24 45 24 58C24 72 36 88 50 88C64 88 76 72 76 58C76 45 68 27 52 24C50 23.5 49 23.5 48 24Z"
                  fill="#FFFDF8"
                />

                {/* Detective Deerstalker Hat (獵鹿帽) */}
                <ellipse cx="50" cy="30" rx="28" ry="9" fill="#78350F" />
                <path
                  d="M28 30C28 17 72 17 72 30Z"
                  fill="#92400E"
                  stroke="#522504"
                  strokeWidth="1.8"
                />
                <path d="M48 17L52 17L51 14L49 14Z" fill="#D99432" />
                <path
                  d="M22 32C22 32 32 35 50 35C68 35 78 32 78 32"
                  stroke="#522504"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d="M36 24H64"
                  stroke="#522504"
                  strokeWidth="1.2"
                  strokeDasharray="2 2"
                />

                {/* Expressive Cute Eyes */}
                {isHovered ? (
                  <>
                    <path
                      d="M38 50C38 46 44 46 44 50"
                      stroke="#18332A"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M56 50C56 46 62 46 62 50"
                      stroke="#18332A"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </>
                ) : (
                  <>
                    <circle cx="41" cy="49" r="3.2" fill="#18332A" />
                    <circle cx="42.5" cy="47.5" r="1" fill="#FFFFFF" />
                    <circle cx="59" cy="49" r="3.2" fill="#18332A" />
                    <circle cx="60.5" cy="47.5" r="1" fill="#FFFFFF" />
                  </>
                )}

                {/* Cheerful Blush */}
                <circle cx="33" cy="55" r="3.5" fill="#FCA5A5" opacity="0.5" />
                <circle cx="67" cy="55" r="3.5" fill="#FCA5A5" opacity="0.5" />

                {/* Mouth */}
                <path
                  d="M47 55C47 58 53 58 53 55"
                  stroke="#18332A"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                {/* Tiny Detective Tie */}
                <path d="M46 65L50 70L54 65L50 64Z" fill="#DC2626" />

                {/* Magnifying Glass */}
                <g transform="translate(62, 56) rotate(15)">
                  <circle
                    cx="7"
                    cy="7"
                    r="6"
                    stroke="#D97706"
                    strokeWidth="2"
                    fill="#E0F2FE"
                    fillOpacity="0.7"
                  />
                  <line
                    x1="12"
                    y1="12"
                    x2="18"
                    y2="18"
                    stroke="#78350F"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </g>
              </svg>
            </div>

            {/* Quick minimize button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMinimized(true);
                setShowBubble(false);
              }}
              aria-label="收合米寶"
              className="absolute -bottom-1 -left-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-500 rounded-full p-1 shadow-xs opacity-0 group-hover:opacity-100 transition-opacity"
              title="收起米寶"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
