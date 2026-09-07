"use client";

import React, { useState, useEffect } from "react";
import { Sparkles, MessageCircle, X, ChevronUp, Award, HelpCircle } from "lucide-react";
import { useGameMode } from "./game-mode-context";

const DETECTIVE_QUOTES = [
  "🔎「報告探長！今日的咖哩似乎大受歡迎，白飯被消滅了 95% 呢！」",
  "🥦「小秘密：把青菜擺在主菜旁邊，不知不覺就能全部吃光光喔！」",
  "🕵️「根據線索，中午吃太急容易剩菜，大家記得細嚼慢嚥才能破案！」",
  "🍚「每拯救 1 公斤剩食，相當於減少 2.5 公斤碳排放，真是太厲害了！」",
  "🎯「發現 AI 辨識有些許誤差？快點『手動校正』，鷹眼偵探非你莫屬！」",
  "✨「今天全班連勝紀錄來到第 5 天！向『光盤神隊友』稱號邁進！」",
  "🍱「剩菜不是壞孩子，只是廚房阿姨煮太大鍋啦！由我們提出精準供餐建議吧！」",
];

export function InspectorRice() {
  const { isGameMode, stats } = useGameMode();
  const [minimized, setMinimized] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [showBubble, setShowBubble] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  // Cycle quote periodically
  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % DETECTIVE_QUOTES.length);
    }, 12000);
    return () => clearInterval(timer);
  }, []);

  if (!isGameMode) return null;

  return (
    <aside
      aria-label="米寶偵探助手"
      className="fixed bottom-6 right-6 z-40 flex flex-col items-end pointer-events-none select-none transition-all duration-300"
    >
      {/* Speech Bubble */}
      {!minimized && showBubble && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto mb-3 max-w-xs bg-amber-50 text-slate-800 border-2 border-amber-400 rounded-2xl p-3.5 shadow-xl relative animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <button
            onClick={() => setShowBubble(false)}
            aria-label="關閉米寶氣泡提示"
            className="absolute -top-2 -right-2 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-full p-1 shadow transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-start gap-2">
            <span className="text-xl shrink-0">🕵️‍♂️</span>
            <div>
              <div className="text-xs font-bold text-amber-800 flex items-center gap-1 mb-1">
                <span>米寶偵探</span>
                <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-full font-semibold">
                  {stats.rankTitle.split(" ")[0]}
                </span>
              </div>
              <p className="text-xs font-medium leading-relaxed text-slate-700">
                {DETECTIVE_QUOTES[quoteIndex]}
              </p>
            </div>
          </div>
          {/* Bubble Tail */}
          <div className="absolute -bottom-2 right-8 w-3 h-3 bg-amber-50 border-r-2 border-b-2 border-amber-400 rotate-45" />
        </div>
      )}

      {/* Mascot Character Avatar */}
      <div className="pointer-events-auto flex items-center gap-2">
        {minimized ? (
          <button
            onClick={() => {
              setMinimized(false);
              setShowBubble(true);
            }}
            className="bg-amber-400 hover:bg-amber-500 text-amber-950 font-bold px-3 py-1.5 rounded-full shadow-lg border-2 border-amber-500 flex items-center gap-1.5 text-xs transition-transform hover:scale-105 active:scale-95"
            title="召喚米寶偵探"
          >
            <span className="text-base">🍚</span>
            <span>米寶偵探</span>
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div
            className="group relative cursor-pointer"
            onClick={() => {
              setQuoteIndex((prev) => (prev + 1) % DETECTIVE_QUOTES.length);
              setShowBubble(true);
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            title="點擊聽米寶偵探說破案線索！"
          >
            {/* Pulsing Aura */}
            <div className="absolute -inset-1 bg-gradient-to-r from-amber-400 to-orange-400 rounded-full blur opacity-40 group-hover:opacity-75 transition duration-500 group-hover:duration-200 animate-pulse" />

            {/* Rice Detective SVG Illustration */}
            <div className="relative w-16 h-16 bg-gradient-to-b from-amber-100 to-amber-200 border-2 border-amber-400 rounded-full shadow-xl flex items-center justify-center overflow-hidden transition-transform duration-300 group-hover:scale-110 active:scale-95">
              <svg viewBox="0 0 100 100" className="w-14 h-14" fill="none">
                {/* Rice Grain Body */}
                <ellipse cx="50" cy="56" rx="26" ry="32" fill="#FFFFFF" stroke="#F59E0B" strokeWidth="2.5" />
                <path d="M48 24C32 27 24 45 24 58C24 72 36 88 50 88C64 88 76 72 76 58C76 45 68 27 52 24C50 23.5 49 23.5 48 24Z" fill="#FFFBEB" />

                {/* Detective Deerstalker Hat (獵鹿帽) */}
                <ellipse cx="50" cy="30" rx="30" ry="10" fill="#92400E" />
                <path d="M28 30C28 16 72 16 72 30Z" fill="#B45309" stroke="#78350F" strokeWidth="2" />
                <path d="M48 16L52 16L51 13L49 13Z" fill="#F59E0B" />
                <path d="M20 32C20 32 30 35 50 35C70 35 80 32 80 32" stroke="#78350F" strokeWidth="3" strokeLinecap="round" />
                <path d="M35 24H65" stroke="#78350F" strokeWidth="1.5" strokeDasharray="2 2" />

                {/* Expressive Cute Eyes */}
                {isHovered ? (
                  <>
                    {/* Happy Crescent Eyes */}
                    <path d="M38 50C38 46 44 46 44 50" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M56 50C56 46 62 46 62 50" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
                  </>
                ) : (
                  <>
                    <circle cx="41" cy="49" r="3.5" fill="#1E293B" />
                    <circle cx="42.5" cy="47.5" r="1.2" fill="#FFFFFF" />
                    <circle cx="59" cy="49" r="3.5" fill="#1E293B" />
                    <circle cx="60.5" cy="47.5" r="1.2" fill="#FFFFFF" />
                  </>
                )}

                {/* Cheerful Blush */}
                <circle cx="33" cy="55" r="4" fill="#FCA5A5" opacity="0.6" />
                <circle cx="67" cy="55" r="4" fill="#FCA5A5" opacity="0.6" />

                {/* Mouth */}
                <path d="M47 55C47 58 53 58 53 55" stroke="#1E293B" strokeWidth="2" strokeLinecap="round" />

                {/* Tiny Detective Cape Tie */}
                <path d="M46 65L50 70L54 65L50 64Z" fill="#DC2626" />

                {/* Magnifying Glass (放大鏡) */}
                <g transform="translate(62, 56) rotate(15)">
                  <circle cx="8" cy="8" r="7" stroke="#D97706" strokeWidth="2.5" fill="#E0F2FE" fillOpacity="0.7" />
                  <line x1="14" y1="14" x2="21" y2="21" stroke="#78350F" strokeWidth="3" strokeLinecap="round" />
                  <path d="M6 6L10 10" stroke="#BAE6FD" strokeWidth="1.5" strokeLinecap="round" />
                </g>
              </svg>

              {/* Little Badge Star */}
              <div className="absolute top-1 right-1 bg-amber-400 text-amber-900 rounded-full p-0.5 shadow">
                <Sparkles className="w-3 h-3 animate-spin duration-3000" />
              </div>
            </div>

            {/* Quick minimize button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMinimized(true);
              }}
              aria-label="收合米寶偵探"
              className="absolute -bottom-1 -left-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-500 rounded-full p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
              title="收合米寶"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
