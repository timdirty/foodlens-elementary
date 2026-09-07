"use client";

import React, { useState } from "react";
import { Search, AlertCircle, HelpCircle, Check, Users, Sparkles } from "lucide-react";
import { useGameMode } from "./game-mode-context";

interface ClueItem {
  id: string;
  label: string;
  icon: string;
  votes: number;
  color: string;
  detectiveNote: string;
}

const INITIAL_CLUES: ClueItem[] = [
  {
    id: "portion",
    label: "份量太大吃不完",
    icon: "📏",
    votes: 8,
    color: "amber",
    detectiveNote: "線索指出：主食份量高估，建議向午餐委員會反映微調！",
  },
  {
    id: "taste",
    label: "神秘調味 / 口味不合",
    icon: "🧂",
    votes: 14,
    color: "red",
    detectiveNote: "今日頭號嫌犯！菜色偏鹹或胡椒過重，學生接受度降低。",
  },
  {
    id: "time",
    label: "時間太短，趕著打球",
    icon: "⏳",
    votes: 9,
    color: "blue",
    detectiveNote: "環境因素！用餐時間被社團或午休擠壓，需人文作息彈性。",
  },
  {
    id: "bones",
    label: "骨頭刺多 / 挑食障礙",
    icon: "🦴",
    votes: 5,
    color: "purple",
    detectiveNote: "食材特性！不可食部分需確實扣除，不可要求學生硬吞。",
  },
  {
    id: "cold",
    label: "餐點送達時偏涼",
    icon: "❄️",
    votes: 3,
    color: "cyan",
    detectiveNote: "物流保溫線索！可比對清運與外送時程紀錄進行追溯。",
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
        if (userVotedId && c.id === userVotedId) return { ...c, votes: c.votes - 1 };
        return c;
      })
    );
    if (!userVotedId) {
      addXp(15);
    }
    setUserVotedId(id);
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-5 sm:p-6 shadow-xl mb-6 border-2 border-indigo-500/40 relative overflow-hidden">
      {/* Glow Effect */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🕵️‍♂️</span>
            <span className="text-xs font-bold tracking-widest text-amber-400 uppercase bg-amber-400/10 border border-amber-400/30 px-2.5 py-0.5 rounded-full">
              案發現場 · 線索收集站
            </span>
          </div>
          <h3 className="text-lg font-black tracking-wide text-white mt-1">
            今日剩食元兇是誰？大家一起投下線索！
          </h3>
          <p className="text-xs text-slate-300">
            匿名提供用餐真實感受，協助食光偵探所找出浪費核心關鍵。
          </p>
        </div>

        {/* Prime Suspect Banner */}
        <div className="bg-red-500/20 border border-red-500/50 rounded-2xl px-3.5 py-2 flex items-center gap-2.5 self-start sm:self-auto">
          <span className="text-2xl animate-bounce">🚨</span>
          <div>
            <div className="text-[10px] font-bold text-red-300 uppercase tracking-wider">
              今日頭號嫌疑原因
            </div>
            <div className="text-sm font-black text-red-200">
              {primeSuspect.label} ({Math.round((primeSuspect.votes / totalVotes) * 100)}%)
            </div>
          </div>
        </div>
      </div>

      {/* Clue Interactive Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {clues.map((clue) => {
          const isSelected = userVotedId === clue.id;
          const percentage = Math.round((clue.votes / totalVotes) * 100);
          return (
            <button
              key={clue.id}
              onClick={() => handleVote(clue.id)}
              className={`flex flex-col text-left p-3.5 rounded-2xl border-2 transition-all relative overflow-hidden group ${
                isSelected
                  ? "bg-amber-500/20 border-amber-400 shadow-lg scale-102"
                  : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">{clue.icon}</span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    isSelected
                      ? "bg-amber-400 text-slate-950"
                      : "bg-white/10 text-slate-300"
                  }`}
                >
                  {clue.votes} 票 ({percentage}%)
                </span>
              </div>

              <div className="text-xs font-bold text-white mb-2 leading-snug">
                {clue.label}
              </div>

              {/* Progress bar inside card */}
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mt-auto">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isSelected ? "bg-amber-400" : "bg-indigo-400"
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {isSelected && (
                <div className="mt-2 text-[10px] font-bold text-amber-300 flex items-center gap-1">
                  <Check className="w-3 h-3 text-amber-400" />
                  <span>你提供的關鍵線索！</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Detective Analysis Box */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 flex items-start gap-3">
        <span className="text-xl shrink-0">💡</span>
        <div className="text-xs text-slate-300">
          <strong className="text-amber-300 font-bold">偵探所案情推論：</strong>
          <span className="ml-1 leading-relaxed">
            {primeSuspect.detectiveNote} 目前已收集 {totalVotes} 位同學的匿名線索，
            資料將自動彙整至下餐供應量協作單，不作個別班級或學生懲處。
          </span>
        </div>
      </div>
    </div>
  );
}
