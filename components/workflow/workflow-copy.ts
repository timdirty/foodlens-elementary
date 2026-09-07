import type {
  DrainageState,
  ResponsibilityCard,
  WasteMeasurementMethod,
  WasteSource,
} from "@/lib/waste-intelligence";
import type {
  CookingMethod,
  MenuDishRole,
  MenuImportSource,
} from "@/lib/menu-intelligence";
import type { FoodCategory } from "@/lib/types";

export const MENU_SOURCE_COPY: Record<
  MenuImportSource,
  { title: string; description: string }
> = {
  structured: {
    title: "結構化資料",
    description: "優先使用學校或供餐公司的標準欄位。",
  },
  csv: {
    title: "貼上 CSV",
    description: "保留原始菜名，再由學生核對分類。",
  },
  ocr: {
    title: "菜單文字辨識",
    description: "辨識照片文字；低信心欄位必須人工確認。",
  },
  demo: {
    title: "載入示範菜單",
    description: "固定可重現，並明確標示 Mock OCR。",
  },
};

export const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  rice: "米飯",
  noodles: "麵類",
  meat: "肉／魚",
  vegetable: "蔬菜",
  egg: "蛋",
  fruit: "水果",
  other: "其他",
};

export const DISH_ROLE_LABELS: Record<MenuDishRole, string> = {
  staple: "主食",
  main: "主菜",
  side: "配菜",
  soup: "湯品",
  fruit: "水果",
  other: "其他",
};

export const COOKING_METHOD_LABELS: Record<CookingMethod, string> = {
  steamed: "蒸",
  boiled: "水煮",
  braised: "滷／紅燒",
  stewed: "燉／燴",
  "stir-fried": "炒",
  "pan-fried": "煎",
  "deep-fried": "炸",
  baked: "烤",
  "cold-mixed": "涼拌",
  soup: "湯",
  raw: "生食",
  unknown: "待確認",
};

export const WASTE_SOURCE_COPY: Record<
  WasteSource,
  { short: string; title: string; description: string; kind: string }
> = {
  prep: {
    short: "01",
    title: "備餐耗損",
    description: "削皮、修切等廚房前端產生的廢棄物。",
    kind: "製程資料",
  },
  "unserved-edible": {
    short: "02",
    title: "未供出可食餐點",
    description: "送到學校但沒有分到餐盤、仍可食用的餐點。",
    kind: "供應資料",
  },
  "plate-edible": {
    short: "03",
    title: "餐盤可食剩食",
    description: "學生餐盤中原本可吃、但沒有吃完的部分。",
    kind: "學生端資料",
  },
  inedible: {
    short: "04",
    title: "不可食部分",
    description: "骨、果皮等不能直接視為浪費的自然部分。",
    kind: "組成資料",
  },
  "liquid-contaminated": {
    short: "05",
    title: "湯汁／混雜物",
    description: "湯汁與混雜物另列，避免灌高可食剩食重量。",
    kind: "品質資料",
  },
};

export const DRAINAGE_LABELS: Record<DrainageState, string> = {
  wet: "含湯汁／未瀝水",
  "standard-drained": "標準瀝水 30 秒",
  dewatered: "脫水後",
};

export const MEASUREMENT_METHOD_LABELS: Record<WasteMeasurementMethod, string> =
  {
    scale: "電子秤實測",
    "ai-estimate": "AI 估計",
    "manual-band": "人工區間估計",
  };

export const RESPONSIBILITY_KIND_LABELS: Record<
  ResponsibilityCard["id"],
  string
> = {
  "headcount-reserve": "人數與備餐",
  "recipe-texture": "食譜與口感",
  delivery: "配送與溫度",
  "vegetable-guardrail": "蔬菜營養護欄",
  "need-more-data": "補足證據",
};

export const RESPONSIBILITY_OWNER_LABELS = {
  "lunch-secretary": "午餐秘書",
  dietitian: "營養師",
  caterer: "供餐公司",
  "teacher-student-team": "師生研究小組",
  "school-committee": "午餐供應委員會",
} as const;

export const CONFIDENCE_LABELS = {
  high: "高信心",
  medium: "中信心",
  low: "低信心",
} as const;

export function formatPercent(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatWeight(value: number) {
  return value >= 1_000
    ? `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value / 1_000)} kg`
    : `${new Intl.NumberFormat("zh-TW").format(value)} g`;
}
