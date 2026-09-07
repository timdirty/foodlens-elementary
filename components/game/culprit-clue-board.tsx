"use client";

import React, { useState } from "react";
import { Pin } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface ClueItem {
  id: string;
  label: string;
  icon: string;
  votes: number;
  detectiveNote: string;
}

const INITIAL_CLUES: ClueItem[] = [
  {
    id: "portion",
    label: "打菜份量偏大吃不完",
    icon: "📏",
    votes: 8,
    detectiveNote:
      "線索分析：打菜時盛得過滿，建議值日生宣導『先少盛、不夠再添』！",
  },
  {
    id: "taste",
    label: "調味偏鹹或胡椒偏重",
    icon: "🧂",
    votes: 14,
    detectiveNote:
      "現場關鍵：國小學童口味較敏感，可透過食光數據向午餐秘書建議清淡少鹽。",
  },
  {
    id: "time",
    label: "用餐時間短，趕著打球",
    icon: "⏳",
    votes: 9,
    detectiveNote:
      "校園作息：吃太急容易消化不良，應提醒同學留足 20 分鐘細嚼慢嚥。",
  },
  {
    id: "bones",
    label: "骨頭果皮不可食部分",
    icon: "🦴",
    votes: 5,
    detectiveNote:
      "科學分流：骨頭與果皮不是浪費！須引導同學確實扣除，不納入可食廚餘。",
  },
  {
    id: "cold",
    label: "送到教室時飯菜偏涼",
    icon: "❄️",
    votes: 3,
    detectiveNote:
      "保溫檢核：秋冬季節走廊風大，可檢視餐桶保溫蓋是否有確實蓋好。",
  },
];

export function CulpritClueBoard() {
  const { isGameMode, addXp } = useGameMode();
  const [clues, setClues] = useState<ClueItem[]>(INITIAL_CLUES);
  const [userVotedId, setUserVotedId] = useState<string | null>(null);

  if (!isGameMode) return null;

  const totalVotes = clues.reduce((acc, c) => acc + c.votes, 0);
  const primeSuspect = [...clues].sort((a, b) => b.votes - a.votes)[0];

  const handleVote = (id: string) => {
    if (userVotedId === id) return;
    setClues((prev) =>
      prev.map((c) => {
        if (c.id === id) return { ...c, votes: c.votes + 1 };
        if (userVotedId && c.id === userVotedId)
          return { ...c, votes: c.votes - 1 };
        return c;
      }),
    );
    if (!userVotedId) {
      addXp(15);
    }
    setUserVotedId(id);
  };

  return (
    <div className="bg-[#fffdf8] border border-[#ebd9b5] rounded-xl p-5 mb-6 text-[var(--ink)] shadow-xs relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#ebd9b5]/80 pb-3.5 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Pin className="w-4 h-4 text-[#d99432]" />
            <span className="text-xs font-bold tracking-wider text-[#7a4f10] bg-[#fdf2dc] px-2.5 py-0.5 rounded border border-[#ebd9b5]">
              案發現場 · 班級線索收集板
            </span>
          </div>
          <h3 className="text-base font-black text-[var(--ink)] mt-1 tracking-tight">
            今天為什麼會有剩餘？全班一起投下真實觀察！
          </h3>
          <p className="text-xs text-[var(--ink-soft)] font-medium">
            不羞辱、不怪罪！用科學方法找出是份量、調味、作息還是不可食骨頭的原因。
          </p>
        </div>

        {/* Prime Suspect Banner */}
        <div className="bg-[#fff] border border-[#d99432]/60 rounded-xl px-3.5 py-2 flex items-center gap-2.5 shrink-0 shadow-xs">
          <span className="text-2xl">{primeSuspect.icon}</span>
          <div>
            <div className="text-[10px] font-bold text-[#7a4f10]">
              今日頭號線索 (
              {Math.round((primeSuspect.votes / totalVotes) * 100)}% 票數)
            </div>
            <div className="text-xs font-black text-[var(--ink)]">
              {primeSuspect.label}
            </div>
          </div>
        </div>
      </div>

      {/* Clues Voting Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {clues.map((clue) => {
          const isVoted = userVotedId === clue.id;
          const votePercent = Math.round((clue.votes / totalVotes) * 100);

          return (
            <button
              key={clue.id}
              type="button"
              onClick={() => handleVote(clue.id)}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                isVoted
                  ? "bg-[#fffdf5] border-[#d99432] shadow-xs scale-101"
                  : "bg-[#fff] border-[var(--line)] hover:bg-[#fbfaf5] hover:border-[#bdd8c4]"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{clue.icon}</span>
                  <span className="text-xs font-black text-[var(--ink)]">
                    {clue.label}
                  </span>
                </div>
                {isVoted && (
                  <span className="text-[10px] bg-[#d99432] text-white font-bold px-1.5 py-0.5 rounded">
                    我投這項 ✓
                  </span>
                )}
              </div>

              {/* Vote progress bar */}
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-1.5 bg-[#f0f0e8] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#d99432] rounded-full transition-all duration-300"
                    style={{ width: `${votePercent}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-[#7a4f10]">
                  {clue.votes} 票
                </span>
              </div>

              <p className="text-[10px] text-[var(--ink-soft)] mt-2 leading-relaxed">
                {clue.detectiveNote}
              </p>
            </button>
          );
        })}
      </div>

      <div className="bg-[#f6faf6] border border-[#bdd8c4] rounded-lg p-2.5 flex items-center justify-between text-xs text-[var(--green-dark)] font-bold">
        <span>
          💡 累計收集 {totalVotes}{" "}
          筆班級觀察反饋；匿名登打保護隱私，杜絕浪費標籤！
        </span>
        <span className="text-[11px] text-[#7a4f10]">投票獎勵 +15 XP</span>
      </div>
    </div>
  );
}
