export type SchoolActivationStatus =
  "ready" | "pending" | "verify" | "optional";

export type SchoolActivationId =
  "public-env" | "teacher-auth" | "membership" | "private-storage" | "real-ai";

export interface SchoolActivationCheck {
  id: SchoolActivationId;
  title: string;
  status: SchoolActivationStatus;
  statusLabel: string;
  detail: string;
  required: boolean;
}

export interface SchoolActivationAssessment {
  checks: SchoolActivationCheck[];
  requiredReady: number;
  requiredTotal: number;
  ready: boolean;
}

interface AssessSchoolActivationInput {
  supabaseConfigured: boolean;
  cloudConnected: boolean;
  storageEvidence: "verified" | "failed" | "untested";
  hasRealAiEvidence: boolean;
}

export function assessSchoolActivation({
  supabaseConfigured,
  cloudConnected,
  storageEvidence,
  hasRealAiEvidence,
}: AssessSchoolActivationInput): SchoolActivationAssessment {
  const checks: SchoolActivationCheck[] = [
    {
      id: "public-env",
      title: "公開連線設定",
      status: supabaseConfigured ? "ready" : "pending",
      statusLabel: supabaseConfigured ? "已設定" : "待部署管理員設定",
      detail: supabaseConfigured
        ? "前端已取得 Supabase URL 與 publishable key；是否可用仍以實際登入為準。"
        : "部署時只加入 Supabase URL 與 publishable key，不在瀏覽器放入高權限金鑰。",
      required: true,
    },
    {
      id: "teacher-auth",
      title: "教師登入",
      status: cloudConnected ? "ready" : "pending",
      statusLabel: cloudConnected ? "登入已驗證" : "待教師登入",
      detail: cloudConnected
        ? "目前工作階段已通過 Supabase Auth，重新整理後仍會嘗試回到校園工作區。"
        : "先由專案管理員建立教師 Auth 帳號，再寄送一次性登入連結；登入表單不會自動建立新帳號。",
      required: true,
    },
    {
      id: "membership",
      title: "學校與角色授權",
      status: cloudConnected ? "ready" : "pending",
      statusLabel: cloudConnected ? "membership 已驗證" : "待管理員建立",
      detail: cloudConnected
        ? "系統已用目前使用者查到同校 membership，並通過 RLS 載入校園資料。"
        : "由 Supabase 專案管理員在受信任後台建立 school 與 membership；網頁端不能自行授權教師角色。",
      required: true,
    },
    {
      id: "private-storage",
      title: "私有餐盤圖片",
      status:
        storageEvidence === "verified"
          ? "ready"
          : storageEvidence === "failed"
            ? "pending"
            : "verify",
      statusLabel:
        storageEvidence === "verified"
          ? "讀寫證據已驗證"
          : storageEvidence === "failed"
            ? "授權讀取失敗"
            : "需用一張測試餐盤驗證",
      detail:
        storageEvidence === "verified"
          ? "校園工作區已有私有物件，且目前可透過短效 signed URL 讀取。"
          : storageEvidence === "failed"
            ? "資料列存在，但私有圖片目前無法取得 signed URL；請檢查 migration、bucket 與 Storage RLS。"
            : "migration 會建立 private plate-images bucket；登入後以一張無個資測試餐盤完成端到端驗收。",
      required: true,
    },
    {
      id: "real-ai",
      title: "真實影像模型（選配）",
      status: hasRealAiEvidence ? "ready" : "optional",
      statusLabel: hasRealAiEvidence ? "已有成功證據" : "Mock 可完整替代",
      detail: hasRealAiEvidence
        ? "目前校園資料已有非 Mock／非人工 provider 的已確認掃描，代表伺服器端模型曾成功回傳。"
        : "沒有 AI Key 仍可用 Mock 或人工輸入完成研究；若啟用真實模型，只在伺服器設定並以授權教師實測。",
      required: false,
    },
  ];
  const requiredChecks = checks.filter((check) => check.required);
  const requiredReady = requiredChecks.filter(
    (check) => check.status === "ready",
  ).length;

  return {
    checks,
    requiredReady,
    requiredTotal: requiredChecks.length,
    ready: requiredReady === requiredChecks.length,
  };
}

interface CreateSchoolActivationHandoffInput {
  siteOrigin: string;
  schoolName: string;
  generatedAt: string;
}

function singleLine(value: string, fallback: string) {
  const normalized = value.replace(/[\r\n]+/g, " ").trim();
  return normalized || fallback;
}

export function normalizeSiteOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw Error();
    return url.origin;
  } catch {
    return "https://your-foodlens-domain.example";
  }
}

export function createSchoolActivationHandoff({
  siteOrigin,
  schoolName,
  generatedAt,
}: CreateSchoolActivationHandoffInput) {
  const origin = normalizeSiteOrigin(siteOrigin);
  const safeSchoolName = singleLine(schoolName, "<學校名稱>");
  const callbackUrl = `${origin}/auth/callback`;

  return `# FoodLens 正式校園模式啟用交接單

- 學校：${safeSchoolName}
- 站點：${origin}
- 產生時間：${singleLine(generatedAt, "<產生時間>")}
- 原則：瀏覽器只使用公開連線設定；教師角色只能由受信任的 Supabase 專案管理員建立。

## 1. 部署公開連線設定

在部署平台加入下列兩個名稱，值請直接從 Supabase Project Connect 取得：

\`\`\`text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
\`\`\`

不要把任何高權限伺服器金鑰放進 \`NEXT_PUBLIC_*\`、原始碼、交接文件或瀏覽器。

## 2. 套用資料庫與 Storage migration

在受信任的管理員環境執行：

\`\`\`bash
supabase db push
\`\`\`

確認 migration history 全部成功；\`plate-images\` 必須是 private bucket，並保留 migration 建立的同校 RLS。專案 migration 也已明確授予 Data API 必要權限，不要在 Dashboard 另開匿名資料表存取。

## 3. 設定 Auth redirect

Supabase Dashboard → Authentication → URL Configuration：

- Site URL：${origin}
- Redirect URL：${callbackUrl}

正式網域使用精確 callback，不使用可導向任意網站的 wildcard。

## 4. 建立教師帳號與 membership

1. 由專案管理員先在 Supabase Authentication → Users 建立或邀請教師。
2. 複製該教師的 Auth User UUID。
3. 在 SQL Editor 先建立學校（既有學校可略過），再建立 membership。

\`\`\`sql
-- 新學校才執行；記下回傳的 school UUID。
insert into public.schools (name, timezone, currency)
values ('${safeSchoolName.replaceAll("'", "''")}', 'Asia/Taipei', 'TWD')
returning id;

-- 用實際 UUID 取代兩個 placeholder；預設只授予 teacher。
insert into public.memberships (school_id, user_id, role)
values ('<SCHOOL_UUID>', '<AUTH_USER_UUID>', 'teacher');
\`\`\`

只有校方明確授權的負責人可使用 \`admin\`；\`viewer\` 只能讀取同校資料。若 insert 因既有 membership 失敗，先查明現有角色，不要直接覆寫。

驗證：

\`\`\`sql
select school.name, membership.user_id, membership.role
from public.memberships as membership
join public.schools as school on school.id = membership.school_id
where membership.user_id = '<AUTH_USER_UUID>';
\`\`\`

## 5. 教師端端到端驗收

1. 在 FoodLens 教師管理 → 校園雲端輸入已建立的教師 Email。
2. 完成一次性連結登入，確認頁面顯示「membership 已驗證」。
3. 建立一個測試班級；拍攝一張不含人臉、姓名、學號或座號的測試餐盤。
4. 確認圖片可重新整理後讀取，並顯示「讀寫證據已驗證」。
5. 登出後確認公開訪客只能看到自己的 Demo，無法讀取校園資料。

## 6. 真實影像模型（選配）

不設定外部模型也能以 Mock／人工輸入完整操作。若校方要啟用真實模型，只在部署平台的伺服器端加入：

\`\`\`text
AI_PROVIDER
AI_API_KEY
AI_MODEL
AI_BASE_URL
\`\`\`

此交接單不收集、顯示或匯出任何金鑰值。請以已授權教師完成一筆測試，再檢查供應商資料使用與保存條款。

## 7. 正式蒐集前簽核

- [ ] 校方確認蒐集目的、同意流程與資料負責人
- [ ] 設定餐盤圖片與餐期資料保存期限
- [ ] Redirect 使用正式精確網域
- [ ] Teacher membership 已由專案管理員驗證
- [ ] Private Storage 已完成一張測試餐盤的讀寫驗收
- [ ] 登出後匿名訪客無法讀取正式資料
- [ ] AI 若啟用，已完成供應商與資料治理審查

FoodLens 的啟用狀態是技術交接提示，不是法遵認證；正式開始前仍由校方負責核准。
`;
}
