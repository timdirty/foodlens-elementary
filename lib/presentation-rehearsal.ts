export type PresentationPhaseId =
  "presentation" | "judge-questions" | "team-answers";

export type FinalRubricKey =
  "feasibility" | "completeness" | "development" | "delivery";

export interface PresentationPhase {
  id: PresentationPhaseId;
  label: string;
  shortLabel: string;
  durationSeconds: number;
  guidance: string;
}

export interface FinalRubric {
  key: FinalRubricKey;
  label: string;
  weight: 30 | 10;
  focus: string;
}

export interface RehearsalQuestion {
  id: string;
  rubric: FinalRubricKey;
  question: string;
  intent: string;
  answerLead: string;
  answerPoints: readonly [string, string, string];
  honestyBoundary: string;
  evidenceLabels: readonly string[];
}

export interface PhaseTimerState {
  durationSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  overtimeSeconds: number;
  progress: number;
  isOvertime: boolean;
}

export const SLIDE_SECONDS = [45, 55, 65, 65, 70, 70, 65, 45] as const;

export const PRESENTATION_PHASES = [
  {
    id: "presentation",
    label: "8 分鐘簡報",
    shortLabel: "簡報",
    durationSeconds: 480,
    guidance: "用八頁完成問題、方法、證據、決策與擴散主線。",
  },
  {
    id: "judge-questions",
    label: "5 分鐘統一提問",
    shortLabel: "提問",
    durationSeconds: 300,
    guidance: "先聽完、記下關鍵字並確認題意；這一段不搶答。",
  },
  {
    id: "team-answers",
    label: "7 分鐘團隊答詢",
    shortLabel: "答詢",
    durationSeconds: 420,
    guidance: "先直接回答，再給證據，最後主動說明限制與下一步。",
  },
] as const satisfies readonly PresentationPhase[];

export const FINAL_RUBRICS = [
  {
    key: "feasibility",
    label: "可行性",
    weight: 30,
    focus: "方法能落地，決策有安全邊界",
  },
  {
    key: "completeness",
    label: "完整性",
    weight: 30,
    focus: "從問題、資料到驗證形成閉環",
  },
  {
    key: "development",
    label: "發展性",
    weight: 30,
    focus: "角色、治理與擴校路徑可延伸",
  },
  {
    key: "delivery",
    label: "發表",
    weight: 10,
    focus: "八分鐘清楚，答詢精準誠實",
  },
] as const satisfies readonly FinalRubric[];

export const SLIDE_RUBRIC_KEYS = [
  ["delivery"],
  ["completeness"],
  ["completeness", "development"],
  ["feasibility", "completeness"],
  ["completeness"],
  ["feasibility"],
  ["feasibility", "completeness"],
  ["development", "delivery"],
] as const satisfies readonly (readonly FinalRubricKey[])[];

export const REHEARSAL_QUESTION_BANK = [
  {
    id: "feasibility-photo-weight",
    rubric: "feasibility",
    question: "一張餐盤照片真的能算出剩食重量嗎？",
    intent: "評審在確認量測方法是否可信，以及你們有沒有說過頭。",
    answerLead: "不能精確秤重；影像只提供可修正的比例初判。",
    answerPoints: [
      "系統先辨識食物類別與剩餘比例，學生逐項修正。",
      "影像估計重量＝標準原始份量 × 剩餘比例，畫面會明確標示估計。",
      "正式研究要同步用電子秤建立基準，才能檢查影像估計誤差。",
    ],
    honestyBoundary:
      "不要說『AI 可以從單張照片精準秤重』；實測重量必須來自秤重或可追溯紀錄。",
    evidenceLabels: ["AI 掃描的人工作業", "五源量測方法"],
  },
  {
    id: "feasibility-food-safety",
    rubric: "feasibility",
    question: "如果照建議減量，學生吃不飽或營養不足怎麼辦？",
    intent: "評審在確認系統是不是把效率放在學生需求之前。",
    answerLead: "FoodLens 只提出保守試算，不會自動改餐。",
    answerPoints: [
      "建議量會保留安全餘量，並依證據品質限制最多減量 15%、8% 或 5%。",
      "營養、出席、補餐與特殊需求仍由營養師和學校一起判斷。",
      "人類採用量會和系統建議分開保存，下一餐再量測是否真的改善。",
    ],
    honestyBoundary:
      "不要說『AI 決定供餐量』；FoodLens 只提供規則型決策參考，最後決定權在人。",
    evidenceLabels: ["智慧供餐預測", "供餐協作單"],
  },
  {
    id: "feasibility-offline",
    rubric: "feasibility",
    question: "比賽現場沒有網路或沒有 AI API，系統還能操作嗎？",
    intent: "評審在確認 Live Demo 是否真的可靠，而不是只靠雲端服務。",
    answerLead: "可以完成示範流程，但會誠實標成『示範規則』。",
    answerPoints: [
      "Demo Mode 用瀏覽器本機資料保存，重新整理後仍可繼續。",
      "沒有模型金鑰時使用固定 Mock 流程，不會冒充真實 AI。",
      "正式校園工作區才連接登入、私有雲端資料與真實模型服務。",
    ],
    honestyBoundary:
      "離線 Demo 證明流程可操作，不代表真實模型辨識能力或正式校園上線成效。",
    evidenceLabels: ["Demo Mode", "Mock／真實 AI 徽章"],
  },
  {
    id: "completeness-not-classifier",
    rubric: "completeness",
    question: "你們怎麼證明這不只是一個食物分類器？",
    intent: "評審在找完整問題解法，而不是單一技術展示。",
    answerLead: "辨識只是入口；真正的產品是兩條可追溯閉環。",
    answerPoints: [
      "預防閉環從菜單、五源量測與匿名原因，走到供餐建議和再量測。",
      "責任閉環把來源分流、交接、收據與校方核驗分開保存。",
      "控制中心、數據實驗室與改善實驗把資料轉成可檢查的決策證據。",
    ],
    honestyBoundary:
      "目前能證明的是原型流程完整；示範資料不能證明學校已經改善。",
    evidenceLabels: ["完整研究流程", "去向追蹤"],
  },
  {
    id: "completeness-human-work",
    rubric: "completeness",
    question: "學生到底做了什麼？是不是 AI 全部做完？",
    intent: "評審在確認人機協作與學生研究素養是否真實存在。",
    answerLead: "AI 只先整理，學生負責確認、修正、解釋與提問。",
    answerPoints: [
      "學生逐欄確認菜單與餐盤初判，未確認前不寫入正式紀錄。",
      "系統同時保存模型原判斷、學生修正與修正理由，錯誤不會被藏起來。",
      "學生再用樣本數、公式與限制解讀結果，向校方提出可討論建議。",
    ],
    honestyBoundary:
      "不要把規則引擎說成生成式 AI，也不要把 AI 初判說成學生研究結論。",
    evidenceLabels: ["人機協作修正", "資料稽核軌跡"],
  },
  {
    id: "completeness-data-quality",
    rubric: "completeness",
    question: "如果輸入資料不準，後面的圖表和建議還可信嗎？",
    intent: "評審在追問資料品質、統計口徑與錯誤防線。",
    answerLead: "所以 FoodLens 不把所有廚餘混成一個總數。",
    answerPoints: [
      "備料、未供餐、餐盤、不可食與液體五種來源分開，日期、班級與方法一起留存。",
      "剩食率用總剩食重量除以總供應重量，不直接平均每筆百分比。",
      "洞察要通過最低樣本和差異門檻；資料不足就顯示需要更多資料。",
    ],
    honestyBoundary:
      "規則只能降低誤判，不能取代現場秤重一致性、抽查與資料清理。",
    evidenceLabels: ["數據實驗室", "樣本門檻"],
  },
  {
    id: "development-school-rollout",
    rubric: "development",
    question: "如果要擴到全校，誰要做什麼？會不會增加很多工作？",
    intent: "評審在確認擴散不是一句口號，而是有角色與步驟。",
    answerLead: "我們會先用兩個班級、小範圍量測，再逐步擴大。",
    answerPoints: [
      "學生協助拍攝與修正，導師確認情境，午餐承辦管理餐期與資料。",
      "營養師審核營養安全，團膳評估製備，清運與處理端提供交接證據。",
      "先跑兩週基準、兩週改善，確認工作量與資料品質後再增加班級。",
    ],
    honestyBoundary: "這是建議的實測路徑，不是已經完成的全校導入。",
    evidenceLabels: ["角色責任圖", "改善實驗"],
  },
  {
    id: "development-privacy",
    rubric: "development",
    question: "家長會不會擔心拍到學生，或班級被拿來排名？",
    intent: "評審在確認未成年人資料與公開溝通是否被認真處理。",
    answerLead: "系統的研究單位是班級餐期，不是個別學生。",
    answerPoints: [
      "拍攝前提醒避開人臉、姓名、學號與座號，圖片只放私有空間。",
      "正式資料採班級層級去識別化，並設定保存期限、刪除與負責人。",
      "家長與公開摘要只呈現聚合趨勢，不公開餐盤圖或班級排名。",
    ],
    honestyBoundary:
      "班級加日期仍可能被辨識，所以應說『去識別化』，不要說『完全匿名』。",
    evidenceLabels: ["倫理與隱私", "資料保留治理"],
  },
  {
    id: "development-vendor",
    rubric: "development",
    question: "營養午餐公司為什麼願意配合？這會不會變成責怪廠商？",
    intent: "評審在確認供餐端的誘因與合作方式。",
    answerLead: "目的不是排名廠商，而是提供可討論、可追溯的回饋。",
    answerPoints: [
      "用相同菜單、份量、出席與原因資料，減少只憑印象溝通。",
      "供餐公司可以回填製備限制與可調整量，學校保留最後決定權。",
      "先選一組重複菜單做小規模前後比較，確認安全再擴大。",
    ],
    honestyBoundary:
      "不能把高剩食直接歸咎於廠商；口味、活動、天氣與出席都可能影響。",
    evidenceLabels: ["供餐協作單", "干擾因素紀錄"],
  },
  {
    id: "delivery-one-sentence",
    rubric: "delivery",
    question: "請用一句話說明 FoodLens 最重要的創新。",
    intent: "評審在測試團隊能不能把產品價值說清楚。",
    answerLead:
      "FoodLens 不是替學校自動決定，而是讓學生用 AI、秤重與人工修正，把剩食變成可追溯的供餐決策。",
    answerPoints: [
      "先點出校園剩食資訊不完整的問題。",
      "再說 AI 初判加上學生修正的人機協作。",
      "最後落在學校可驗證的決策閉環，而不是炫耀模型。",
    ],
    honestyBoundary: "一句話不要塞入尚未完成的實測成效或精確減碳數字。",
    evidenceLabels: ["8 分鐘簡報封面", "兩條閉環"],
  },
  {
    id: "delivery-real-result",
    rubric: "delivery",
    question: "你們目前真的減少了多少廚餘？",
    intent: "評審在測試團隊遇到尖銳問題時，能不能守住證據邊界。",
    answerLead: "目前還不能宣稱已經減少；首版顯示的是模擬情境。",
    answerPoints: [
      "27% 到 19% 是可重現的前後比較示範，不是參賽團隊實測結果。",
      "年度減量是依可見假設換算的情境，不是環境成效證明。",
      "下一步是取得校方同意，先建立基準期，再做小規模改善與再量測。",
    ],
    honestyBoundary:
      "不要回答任何『已減少 X 公斤』；只有完成實測與核驗後才能改寫這句話。",
    evidenceLabels: ["改善實驗限制", "永續影響算式"],
  },
  {
    id: "delivery-ai-disclosure",
    rubric: "delivery",
    question: "作品哪裡用了 AI？如果 AI 判錯，系統還成立嗎？",
    intent: "評審在確認 AI 使用揭露、可替換性與失敗處理。",
    answerLead: "AI 負責可替換的初判；即使判錯，人工修正與秤重流程仍成立。",
    answerPoints: [
      "菜單 OCR 與餐盤辨識只產生草稿，真實／Mock 會逐次標示。",
      "學生能修改類別、比例與原因，原始結果仍保留供檢查。",
      "統計洞察與供餐上限是透明規則，不會被包裝成影像 AI。",
    ],
    honestyBoundary:
      "要說出實際使用的工具與用途；生成示範圖片不納入辨識準確率或研究結果。",
    evidenceLabels: ["AI 使用揭露", "人工確認流程"],
  },
] as const satisfies readonly RehearsalQuestion[];

export const REHEARSAL_QUESTION_PACKS = [
  [
    "feasibility-photo-weight",
    "completeness-not-classifier",
    "development-school-rollout",
    "delivery-real-result",
  ],
  [
    "feasibility-food-safety",
    "completeness-human-work",
    "development-privacy",
    "delivery-one-sentence",
  ],
  [
    "feasibility-offline",
    "completeness-data-quality",
    "development-vendor",
    "delivery-ai-disclosure",
  ],
] as const;

export function getRubric(key: FinalRubricKey) {
  return FINAL_RUBRICS.find((rubric) => rubric.key === key)!;
}

export function getPhase(id: PresentationPhaseId) {
  return PRESENTATION_PHASES.find((phase) => phase.id === id)!;
}

export function getQuestion(id: string): RehearsalQuestion | undefined {
  return REHEARSAL_QUESTION_BANK.find((question) => question.id === id);
}

export function getQuestionPack(index: number): readonly RehearsalQuestion[] {
  const normalizedIndex =
    ((index % REHEARSAL_QUESTION_PACKS.length) +
      REHEARSAL_QUESTION_PACKS.length) %
    REHEARSAL_QUESTION_PACKS.length;
  return REHEARSAL_QUESTION_PACKS[normalizedIndex]
    .map(getQuestion)
    .filter((question): question is RehearsalQuestion => Boolean(question));
}

export function getPhaseTimerState(
  phase: PresentationPhaseId,
  elapsedSeconds: number,
): PhaseTimerState {
  const durationSeconds = getPhase(phase).durationSeconds;
  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds));
  const remainingSeconds = Math.max(0, durationSeconds - safeElapsed);
  const overtimeSeconds = Math.max(0, safeElapsed - durationSeconds);

  return {
    durationSeconds,
    elapsedSeconds: safeElapsed,
    remainingSeconds,
    overtimeSeconds,
    progress: Math.min(1, safeElapsed / durationSeconds),
    isOvertime: overtimeSeconds > 0,
  };
}
