import type {
  AppSnapshot,
  FoodCategory,
  ImprovementExperiment,
  ResearchSection,
} from "@/lib/types";
import { calendarWeekday } from "@/lib/date";
import { createDemoEvidenceCases } from "@/lib/evidence-chain";
import { createDemoCircularityTrace } from "@/lib/circularity";
import { createDemoMealSafetyObservations } from "@/lib/demo-meal-safety";

export const DEMO_SEED_VERSION = 19;
export const DEMO_REFERENCE_DATE = "2026-10-16";

const classes = [
  { id: "class-5a", name: "五年一班", grade: 5 as const, active: true },
  { id: "class-5b", name: "五年二班", grade: 5 as const, active: true },
  { id: "class-6a", name: "六年一班", grade: 6 as const, active: true },
  { id: "class-6b", name: "六年二班", grade: 6 as const, active: true },
];

const menus = [
  {
    date: "2026-08-24",
    rate: 0.245,
    staple: "白飯",
    main: "茄汁肉丸",
    sides: ["高麗菜", "玉米蛋"],
    people: 25,
  },
  {
    date: "2026-08-28",
    rate: 0.295,
    staple: "白飯",
    main: "醬燒雞腿",
    sides: ["青花菜", "柳橙"],
    people: 26,
  },
  {
    date: "2026-08-31",
    rate: 0.17,
    staple: "咖哩飯",
    main: "雞肉咖哩",
    sides: ["花椰菜", "豆干"],
    people: 25,
  },
  {
    date: "2026-09-11",
    rate: 0.305,
    staple: "白飯",
    main: "香煎魚排",
    sides: ["炒青江菜", "番茄蛋"],
    people: 26,
  },
  {
    date: "2026-09-16",
    rate: 0.24,
    staple: "糙米飯",
    main: "滷肉",
    sides: ["空心菜", "芭樂"],
    people: 24,
  },
  {
    date: "2026-09-18",
    rate: 0.265,
    staple: "白飯",
    main: "照燒雞肉",
    sides: ["菠菜", "蒸蛋"],
    people: 26,
  },
  {
    date: "2026-09-24",
    rate: 0.13,
    staple: "咖哩飯",
    main: "雞肉咖哩",
    sides: ["青花菜", "毛豆"],
    people: 25,
  },
  {
    date: "2026-09-25",
    rate: 0.245,
    staple: "白飯",
    main: "三杯雞",
    sides: ["高麗菜", "鳳梨"],
    people: 25,
  },
  {
    date: "2026-09-29",
    rate: 0.2,
    staple: "咖哩飯",
    main: "雞肉咖哩",
    sides: ["地瓜葉", "滷蛋"],
    people: 26,
  },
  {
    date: "2026-10-07",
    rate: 0.18,
    staple: "白飯",
    main: "蜜汁雞丁",
    sides: ["小白菜", "香蕉"],
    people: 25,
  },
  {
    date: "2026-10-14",
    rate: 0.175,
    staple: "白飯",
    main: "清蒸魚",
    sides: ["花椰菜", "番茄炒蛋"],
    people: 26,
  },
  {
    date: "2026-10-16",
    rate: 0.205,
    staple: "陽春麵",
    main: "滷雞腿",
    sides: ["高麗菜", "芭樂"],
    people: 25,
  },
] as const;

const categoryPool: Array<[FoodCategory, string, number, number]> = [
  ["rice", "白飯", 120, 0.31],
  ["vegetable", "青菜", 80, 0.42],
  ["meat", "肉類", 75, 0.14],
  ["egg", "蛋", 55, 0.16],
  ["fruit", "水果", 70, 0.24],
  ["noodles", "麵類", 150, 0.19],
  ["other", "其他配菜", 60, 0.21],
];

function nowOn(date: string, hour = 13) {
  return `${date}T${String(hour).padStart(2, "0")}:20:00+08:00`;
}

function researchSections(): ResearchSection[] {
  const updatedAt = nowOn(DEMO_REFERENCE_DATE, 16);
  const rows: Array<[string, string, string]> = [
    [
      "background",
      "01｜問題與在地背景",
      "臺北市校園每天供應大量午餐。當餐後只留下「今天剩很多」的印象，學校很難知道浪費集中在哪一類食物、哪一種菜單或哪一天。FoodLens 將餐盤觀察轉成可追蹤的「不收集姓名與學號的班級層級去識別化資料」，讓討論從感覺走向證據。\n\n115 年臺北市教育局說明，115 學年度免費營養午餐約涵蓋 18.6 萬名學生，並規劃逐步進行各校廚餘總量資料分析。115 年市府公開案例也提到，學校透過即時份量調整、食用回饋與營養師調整供應降低剩食。FoodLens 嘗試補上「餐盤食物類別、人工校正與可追溯決策」這一層證據。\n\n> 目前只有系統原型測試；本站 48 筆餐期與 96 份餐盤皆為 **可重現的模擬情境資料**，不可當作真實校園研究發現或改善成果。",
    ],
    [
      "question",
      "02｜研究問題與假設",
      "**核心問題：** AI 能不能透過真實校園剩食資料，協助學校做出更好的供餐決策？\n\n我們不只測「剩多少」，而是檢查四項待驗證假設：先把未供出、盤後可食、不可食與液體等來源分開，會比混合總重更能指出改善位置；AI 初判加上學生修正，會比盲信模型更可追溯；連結菜單版本、實到人數、匿名原因與配送情境，會比單一重量更有解釋力；由營養師核准低風險調整後再量測，可能在不增加缺餐的前提下降低可避免剩食。",
    ],
    [
      "stakeholders",
      "03｜誰會使用",
      "FoodLens 把八個角色放進同一條可追溯證據鏈，但不讓 AI 取代任何人的權責：\n\n- **學生：** 拍攝、檢查初判、提出匿名原因；不被建立個人完食分數。\n- **導師／教室：** 確認實到人數、秤重與活動情境；不負責判定營養量。\n- **營養師／午餐秘書：** 管理菜單、安全餘量與營養評估；可採用、調整或拒絕建議。\n- **校方／午餐委員會：** 核准試行、檢視履約與改善成果；Demo 不混入正式校務資料。\n- **家長代表：** 只看去識別化週報、估算假設與改善理由；不看個別餐盤。\n- **團膳／午餐公司：** 提供食譜版本、製作與配送情境，改良備料、烹調或配送；不以單一剩食率懲罰。\n- **清運／處理單位：** 回填交接淨重、實際去向與憑證；預定去向不算已驗證成果。\n- **教育／環保單位：** 只取得去識別化校級趨勢，用於標準、輔導與資料品質，不取得學生影像。\n\n潛在衝突是「減少浪費」可能與「營養、吃飽、現場負擔與履約公平」發生拉鋸。FoodLens 只讓各角色看見適合其權責的同一筆證據，不另造一個 AI 權力中心。",
    ],
    [
      "method",
      "04｜資料蒐集與研究方法",
      "1. 先載入結構化菜單；只有紙本或圖片時才用「紙本菜單 OCR」建立草稿，保留原文並由人逐欄確認。PDF 首版需先轉成頁面圖片，不宣稱可直接讀取 PDF。\n2. 建立餐期與供餐批次，記錄日期、實到人數、菜單／食譜版本、實際供應量與已知配送情境。\n3. 只拍餐盤食物，不拍人臉、姓名、學號或座號；AI 初判後，學生修正並確認才保存。\n4. 用電子秤扣除容器，分開前處理廢棄、未供出可食餐點、盤後可食剩食、不可食殘渣及液體／污染，並收集匿名原因。\n5. 使用總剩食重量 ÷ 總供應重量計算加權剩食率；比較星期、菜色、食譜、食物類別、班級與介入前後。\n6. 供餐建議先交由營養師／學校選擇採用、調整或維持原案，下一餐以相同定義再量測。\n7. 廢棄物去向只有在校方交接、處理端收據與校方核驗俱全後，才列為已確認。",
    ],
    [
      "roles",
      "05｜AI 與人的分工",
      "- **菜單／餐盤模型：** 只建立可編輯初判；不能從照片證明過敏原、營養成分、供應商、食材批次或精確重量。\n- **統計規則引擎：** 以相同公式計算加權比例、檢查樣本門檻，並依匹配品質限制最多減量 15%、8% 或 5%；這是可檢視規則，不是影像 AI。\n- **學生：** 逐欄確認菜單、修正餐盤初判、收集匿名原因，並解釋 AI 為什麼可能錯。\n- **專業與權責角色：** 導師確認現場；營養師審核營養與安全；團膳評估製備可行性；校方依權責決定；清運與處理端提供交接與收據。\n\nFoodLens 保存模型原判斷與人工修正，也分開系統試算、校方原計畫、人類採用量、預定去向與已核驗去向，讓每個過程都可被追問。",
    ],
    [
      "results",
      "06｜目前結果",
      "目前只有系統原型測試，尚無真實校園研究結果。示範資料為測試智慧菜單、五源量測、圖表、洞察門檻、供餐協作、前後比較與去向核驗而 **刻意設計** 的可重現情境。其中包含星期五偏高、蔬菜偏高、咖哩偏低、後期下降，以及待交接、收據待核驗與已核驗三種去向狀態。這些數字只證明系統能重新計算與追溯，不代表校園實測發現、介入成效或真實處理績效。\n\n改善情境同時呈現原始比例、下降百分點、相對改善率、班級餐期筆數與獨立供餐日數；去向頁只將有收據且已由校方核驗的事件列為完成。",
    ],
    [
      "limitations",
      "07｜限制與不確定性",
      "單張 2D 照片不能精確秤重；FoodLens 顯示的是「標準原始份量 × 影像估計比例」，整班總量仍以扣除容器後的電子秤淨重為準。OCR 與餐盤模型可能因混合菜、遮擋、光線與臺灣菜色而錯，需按欄位與食物類別追蹤人工修正。前後比較可能受菜色、出席、配送、活動與天氣影響，不能直接宣稱因果。預定清運方式不是實際去向；收據指紋也只證明 FoodLens 核對的外部文件版本，學校仍需依當期政策、合約與現場資料核實。",
    ],
    [
      "ethics",
      "08｜倫理、隱私與公平",
      "正式研究前需取得校方同意。學生訪談採自願、不記名、不錄音，可拒答且不影響午餐或學習。系統不收集姓名或學號，但仍保留班級與日期，因此正確名稱是「班級層級去識別化資料」，不是完全匿名。家長與公開摘要只提供聚合趨勢、假設與改善理由，不公開餐盤圖片或班級排名。\n\n正式研究前必須定義餐盤圖片與修正紀錄的保存期限、唯一負責者、退出／刪除方式與校方檢視周期。FoodLens 會先預覽待清理影像數與截止日，再由授權管理者確認；應用層完成不代表雲端備份立即消失。實測不以模型結果評分學生、班級或廠商，不強迫完食，不自動減餐，也不從照片推測個人健康或過敏原。",
    ],
    [
      "ai-disclosure",
      "09｜AI 使用揭露",
      "本作品使用 OpenAI Codex 協助網站架構、TypeScript／SQL 程式碼草擬、除錯與測試建議；使用 OpenAI 內建圖像生成工具製作 3 張示範餐盤、1 張示範紙本菜單與 1 張研究桌品牌視覺。3 張餐盤用於示範掃描；紙本菜單只用來演練菜單照片匯入與 Mock OCR；研究桌品牌視覺用於簡報封面、研究封面與社群預覽。這些生成素材都不納入辨識準確率或研究結果。\n\n若正式啟用 OpenAI-compatible 多模態模型，模型只負責餐盤食物類別與剩餘比例初判。所有研究問題、量測方法、資料查核、人工修正、引用與供餐決定，均由學生、教師及學校人員負責。示範模式的 `foodlens-mock` 是固定規則模擬，不代表真實模型辨識能力。正式報名時將依實際使用紀錄完整填入報名表。",
    ],
    [
      "future",
      "10｜未來發展與擴校",
      "- **第一階段：1 班 4 週。** 由學生、導師與營養師驗證菜單確認、拍照、五源秤重、人工修正率、每餐操作時間與一項低風險改善。\n- **第二階段：同年級 8 週。** 納入團膳／午餐公司的食譜版本、製作與配送情境，由營養師設定供餐安全界線，家長代表只看去識別化週報。\n- **第三階段：全校 1 學期。** 由午餐委員會檢查跨年級代表性、維運成本、履約公平、權限、圖片保存期限與清運去向憑證。\n- **第四階段：經授權跨校。** 只分享去識別化的菜色、重量、期間、樣本與資料品質，建立共通字典與模型監測，不做學校羞辱排名。\n\n每階段若未達資料品質、營養／供餐安全、現場負擔、隱私或去向憑證門檻，就不擴大。所需設備為可拍照裝置、電子秤與教師帳號；無網路時可用本機 Demo，正式校園資料則由教師登入私有工作區。",
    ],
  ];
  return rows.map(([slug, title, bodyMarkdown], index) => ({
    id: `research-${slug}`,
    slug,
    title,
    bodyMarkdown,
    sortOrder: index + 1,
    isPublished: true,
    updatedAt,
  }));
}

export function createDemoSnapshot(): AppSnapshot {
  const circularityTrace = createDemoCircularityTrace();
  const meals: AppSnapshot["meals"] = [];
  const scans: AppSnapshot["scans"] = [];
  const detections: AppSnapshot["detections"] = [];
  const corrections: AppSnapshot["corrections"] = [];

  menus.forEach((menu, menuIndex) => {
    classes.forEach((schoolClass, classIndex) => {
      const id = `meal-${String(menuIndex + 1).padStart(2, "0")}-${schoolClass.id}`;
      const actualPeople = menu.people + (classIndex % 2);
      const perPersonG = menu.staple.includes("麵") ? 285 : 265;
      const totalSupplyG = actualPeople * perPersonG;
      const classDelta = [-0.012, -0.004, 0.004, 0.012][classIndex];
      const leftoverRate = Math.max(
        0.05,
        Math.min(0.6, menu.rate + classDelta),
      );
      const leftoverG = Math.round(totalSupplyG * leftoverRate);
      meals.push({
        id,
        classId: schoolClass.id,
        servedOn: menu.date,
        mealPeriod: "lunch",
        staple: menu.staple,
        mainDish: menu.main,
        sideDishes: [...menu.sides],
        menuSignature: `${menu.staple}|${menu.main}`.toLowerCase(),
        plannedPeople: actualPeople,
        actualPeople,
        totalSupplyG,
        leftoverG,
        measurementMethod: "scale",
        notes:
          menuIndex < 6 ? "改善前觀察期" : "依據前期資料調整份量與菜色搭配",
        source: "demo",
        createdAt: nowOn(menu.date),
        updatedAt: nowOn(menu.date),
      });

      [0, 1].forEach((scanOffset) => {
        const scanId = `scan-${String(menuIndex + 1).padStart(2, "0")}-${schoolClass.id}-${scanOffset + 1}`;
        const imageIndex = (menuIndex + classIndex + scanOffset) % 3;
        const imageUrl = [
          "/demo/plate-curry.png",
          "/demo/plate-greens.png",
          "/demo/plate-noodles.png",
        ][imageIndex];
        scans.push({
          id: scanId,
          mealRecordId: id,
          imageUrl,
          analysisKind: "mock-ai",
          menuContext: null,
          provider: "foodlens-mock",
          model: "deterministic-v1",
          schemaVersion: "1",
          status: "confirmed",
          reviewedAt: nowOn(menu.date, 13),
          createdAt: nowOn(menu.date, 13),
        });

        const indexes = menu.staple.includes("麵")
          ? [5, 1, 2]
          : [0, 1, ((menuIndex + scanOffset) % 4) + 2];
        indexes.forEach((poolIndex, detectionIndex) => {
          const [category, label, originalG, baseRatio] =
            categoryPool[poolIndex];
          const isFriday = calendarWeekday(menu.date) === 5;
          const curryDelta = menu.staple.includes("咖哩") ? -0.055 : 0;
          const variation =
            (((menuIndex * 7 + classIndex * 3 + scanOffset + detectionIndex) %
              7) -
              3) *
            0.008;
          const ratio = Math.max(
            0.04,
            Math.min(
              0.72,
              baseRatio +
                (isFriday ? 0.045 : 0) +
                curryDelta +
                variation -
                menuIndex * 0.004,
            ),
          );
          const detectionId = `${scanId}-d${detectionIndex + 1}`;
          const remainingG = Math.round(originalG * ratio);
          detections.push({
            id: detectionId,
            scanId,
            category,
            label,
            aiOriginalG: originalG,
            aiRemainingRatio: Number(ratio.toFixed(3)),
            aiRemainingG: remainingG,
            confidence: Number(
              (0.76 + ((menuIndex + detectionIndex) % 4) * 0.05).toFixed(2),
            ),
            sortOrder: detectionIndex,
          });
          if (
            (menuIndex + classIndex + scanOffset + detectionIndex) % 4 ===
            0
          ) {
            const correctedRatio = Math.max(0.03, ratio - 0.03);
            corrections.push({
              id: `${detectionId}-correction`,
              detectionId,
              correctedCategory: category,
              correctedLabel: label,
              correctedOriginalG: originalG,
              correctedRemainingRatio: Number(correctedRatio.toFixed(3)),
              correctedRemainingG: Math.round(originalG * correctedRatio),
              note: "學生依餐盤邊界人工修正",
              correctedAt: nowOn(menu.date, 13),
            });
          }
        });
      });
    });
  });

  const experiments: ImprovementExperiment[] = [
    {
      id: "experiment-demo-1",
      title: "份量微調與青菜呈現方式改善",
      baselineStart: "2026-08-24",
      baselineEnd: "2026-08-28",
      interventionStart: "2026-10-14",
      interventionEnd: "2026-10-16",
      interventionDescription:
        "保留安全餘量、分批補餐，並將青菜切小與調整調味；學生持續回報。",
      safetyGuardrails: {
        shortageReportCount: 1,
        refillRequestCount: 5,
        satisfactionScore: 4.1,
        satisfactionResponseCount: 88,
        dietitianReview: "confirmed",
        dietitianNote:
          "此為系統測試情境：保留現場補餐量，示範如何把營養師確認與剩食結果一起保存。",
        confounders: ["前後期菜色不同", "改善週包含不同班級出席狀況"],
        checkedAt: nowOn("2026-10-16", 15),
      },
      createdAt: nowOn(DEMO_REFERENCE_DATE, 16),
    },
  ];

  return {
    classes,
    meals,
    scans,
    detections,
    corrections,
    predictions: [],
    experiments,
    mealSafetyObservations: createDemoMealSafetyObservations(meals),
    evidenceCases: createDemoEvidenceCases(),
    collectionEvents: circularityTrace.collectionEvents,
    destinationReceipts: circularityTrace.destinationReceipts,
    researchSections: researchSections(),
    impactSettings: {
      id: "default",
      costTwdPerKg: 80,
      schoolDailyBaselineG: 38600,
      schoolDaysPerWeek: 5,
      weeksPerSemester: 20,
      semestersPerYear: 2,
      sourceTitle: "FoodLens 示範情境假設（非本校實測或外部統計）",
      retrievedAt: DEMO_REFERENCE_DATE,
      disclaimer:
        "示範假設為全校每日剩食 38.6 kg；所有成本與擴散結果皆只展示計算方法，不代表本校實測、已達成果或精確科學量測。",
      updatedAt: nowOn(DEMO_REFERENCE_DATE, 16),
    },
    profile: {
      id: "default",
      projectName: "FoodLens 食光偵探",
      subtitle: "AI 校園剩食分析與智慧供餐系統",
      schoolName: "示範學校",
      teamName: "學生研究團隊",
      teamMembers: "團隊資料尚待教師填寫",
      researchPeriod: "115 學年度第一學期 8 週示範研究",
      aiDisclosure:
        "OpenAI Codex 協助網站程式草擬、除錯與測試建議；OpenAI 圖像生成工具製作 3 張示範餐盤、1 張示範紙本菜單與 1 張品牌視覺。示範照片辨識與菜單 OCR 皆為固定規則模擬，不代表真實模型效能；正式報名將依實際使用紀錄完整揭露。",
      dataRetentionDays: 180,
      updatedAt: nowOn(DEMO_REFERENCE_DATE, 16),
    },
  };
}
