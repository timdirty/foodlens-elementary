import { expect, test, type TestInfo } from "@playwright/test";

const desktopOnly = (testInfo: TestInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "資料寫入與尺寸矩陣只需在隔離桌機情境驗證一次",
  );
};

test("未啟用真實模型時可直接人工判讀、確認並保存", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  await page.goto("/scan");
  await expect(
    page.getByRole("heading", { name: "影像先整理，學生做最後確認" }),
  ).toBeVisible({ timeout: 20_000 });
  const scanDate = "2026-10-12";
  await page.getByLabel("日期", { exact: true }).fill(scanDate);
  await page.getByLabel("主食", { exact: true }).fill("白飯");
  await page.getByLabel("主菜", { exact: true }).fill("咖哩雞肉");
  await page.getByLabel("配菜（用頓號分隔）").fill("青花菜、玉米");
  await page.getByRole("button", { name: "下一步：選擇餐盤" }).click();

  await expect(
    page.getByRole("button", { name: "真實模型（需教師登入）" }),
  ).toBeDisabled();
  await expect(
    page.getByText("這個操作不會呼叫 AI 或任何模型。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "直接建立人工判讀表" }).click();

  await expect(
    page.getByRole("heading", { name: "沒有模型也能建立可稽核資料" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("人工判讀 · 無 AI 模型輸出")).toBeVisible();
  await page.getByRole("slider", { name: "白飯剩餘比例" }).fill("40");
  await expect(page.getByText("已人工修正").first()).toBeVisible();
  await page.getByRole("checkbox", { name: /我已逐項人工檢查/ }).check();
  await page.getByRole("button", { name: "確認並寫入資料" }).click();
  await expect(
    page.getByRole("heading", { name: "掃描紀錄建立完成" }),
  ).toBeVisible({ timeout: 20_000 });
  const continuation = page.getByRole("navigation", {
    name: "完成掃描後的建議路徑",
  });
  await expect(
    continuation.getByRole("link", { name: /核對修正證據/ }),
  ).toBeVisible();
  await expect(
    continuation.getByRole("link", { name: /看資料如何改變/ }),
  ).toBeVisible();
  await expect(
    continuation.getByRole("link", { name: /試算下一餐/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: "查看每日紀錄" }).click();
  await page.getByLabel("日期", { exact: true }).fill(scanDate);
  await page
    .getByRole("button", {
      name: new RegExp(`展開${scanDate} 咖哩雞肉的影像判讀與人工證據`),
    })
    .click();
  await expect(page.getByText("已人工修正 1 項 · 人工判讀已確認")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("人工判讀 · 無 AI").first()).toBeVisible();
  await expect(page.locator(".scan-evidence-grid")).toContainText("已修正");
});

test("掃描中斷後可恢復表單、照片與人工判讀且仍需重新確認", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/scan");
  await expect(
    page.getByRole("heading", { name: "影像先整理，學生做最後確認" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("日期", { exact: true }).fill("2026-11-03");
  await page.getByLabel("主食", { exact: true }).fill("紫米飯");
  await page.getByLabel("主菜", { exact: true }).fill("照燒豆腐");
  await page.getByLabel("配菜（用頓號分隔）").fill("菠菜、南瓜");
  await page.getByRole("button", { name: "下一步：選擇餐盤" }).click();
  await page.getByRole("button", { name: "直接建立人工判讀表" }).click();
  await page.getByRole("slider", { name: "紫米飯剩餘比例" }).fill("43");
  await page.waitForTimeout(600);

  await page.reload();
  const recovery = page.getByRole("region", { name: "未送出掃描草稿" });
  await expect(recovery).toContainText("尚未新增餐期、掃描或上傳正式記錄", {
    timeout: 20_000,
  });
  await recovery.getByRole("button", { name: "繼續草稿" }).click();
  await expect(
    page.getByRole("heading", { name: "沒有模型也能建立可稽核資料" }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "紫米飯剩餘比例" }),
  ).toHaveValue("43");
  await expect(
    page.getByRole("checkbox", { name: /我已逐項人工檢查/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "確認並寫入資料" }),
  ).toBeDisabled();
});

test("學生檢查但未改值時誠實顯示零項調整", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  const scanDate = "2026-10-19";

  await page.goto("/scan");
  await expect(
    page.getByRole("heading", { name: "影像先整理，學生做最後確認" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("日期", { exact: true }).fill(scanDate);
  await page.getByLabel("主食", { exact: true }).fill("糙米飯");
  await page.getByLabel("主菜", { exact: true }).fill("香煎豆腐");
  await page.getByLabel("配菜（用頓號分隔）").fill("菠菜、南瓜");
  await page.getByRole("button", { name: "下一步：選擇餐盤" }).click();
  await page.getByRole("button", { name: "直接建立人工判讀表" }).click();
  await page.getByRole("checkbox", { name: /我已逐項人工檢查/ }).check();
  await page.getByRole("button", { name: "確認並寫入資料" }).click();
  await expect(
    page.getByRole("heading", { name: "掃描紀錄建立完成" }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "查看每日紀錄" }).click();
  await page.getByLabel("日期", { exact: true }).fill(scanDate);
  await page
    .getByRole("button", {
      name: new RegExp(`展開${scanDate} 香煎豆腐的影像判讀與人工證據`),
    })
    .click();
  await expect(
    page.getByText("已人工確認，0 項調整", { exact: false }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".scan-evidence-grid")).not.toContainText("已修正");
});

test("同班同日菜單衝突必須明確選擇，不會靜默建立重複餐期", async ({ page }) => {
  await page.goto("/scan");
  await expect(
    page.getByText("此班今天已有午餐資料，請選擇照片歸屬"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("陽春麵・滷雞腿", { exact: true })).toBeVisible();
  await expect(page.getByText("餐後秤重", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下一步：選擇餐盤" }),
  ).toBeDisabled();

  await page.getByLabel("主菜", { exact: true }).fill("滷雞腿（誤植）");
  await expect(
    page.getByText("此班今天已有午餐資料，請選擇照片歸屬"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下一步：選擇餐盤" }),
  ).toBeDisabled();

  await page
    .getByRole("button", { name: /加入既有餐期：陽春麵・滷雞腿/ })
    .click();
  await expect(page.getByText("已選擇加入這筆既有餐期")).toBeVisible();
  await expect(page.getByLabel("主菜", { exact: true })).toHaveValue("滷雞腿");
  await expect(page.getByLabel("主菜", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "下一步：選擇餐盤" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "重新選擇餐期歸屬" }).click();
  await expect(page.getByLabel("主菜", { exact: true })).toHaveValue(
    "滷雞腿（誤植）",
  );
  await expect(
    page.getByText("此班今天已有午餐資料，請選擇照片歸屬"),
  ).toBeVisible();

  await page.getByRole("button", { name: "建立新的獨立餐期" }).click();
  await expect(page.getByText("已選擇建立新的獨立餐期")).toBeVisible();
  await expect(page.getByLabel("主菜", { exact: true })).toHaveValue(
    "滷雞腿（誤植）",
  );
  await expect(page.getByLabel("主菜", { exact: true })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "下一步：選擇餐盤" }),
  ).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("已選擇建立新的獨立餐期")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("明確選擇既有餐期後會把餐盤存入該筆 ID", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  const mealId = "meal-12-class-5a";

  await page.goto("/scan");
  await expect(
    page.getByText("此班今天已有午餐資料，請選擇照片歸屬"),
  ).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole("button", { name: /加入既有餐期：陽春麵・滷雞腿/ })
    .click();
  await page.getByRole("button", { name: "下一步：選擇餐盤" }).click();
  await page.getByRole("button", { name: "直接建立人工判讀表" }).click();
  await page.getByRole("checkbox", { name: /我已逐項人工檢查/ }).check();
  await page.getByRole("button", { name: "確認並寫入資料" }).click();

  await expect(
    page.getByRole("heading", { name: "掃描紀錄建立完成" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(mealId, { exact: true })).toBeVisible();
});

test("恢復同日掃描草稿時必須重新確認餐期歸屬", async ({ page }, testInfo) => {
  desktopOnly(testInfo);

  await page.goto("/scan");
  await expect(
    page.getByText("此班今天已有午餐資料，請選擇照片歸屬"),
  ).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole("button", { name: /加入既有餐期：陽春麵・滷雞腿/ })
    .click();
  await page.getByRole("button", { name: "下一步：選擇餐盤" }).click();
  await page.waitForTimeout(600);

  await page.reload();
  const recovery = page.getByRole("region", { name: "未送出掃描草稿" });
  await expect(recovery).toBeVisible({ timeout: 20_000 });
  await recovery.getByRole("button", { name: "繼續草稿" }).click();

  await expect(
    page.getByRole("heading", { name: "先確認這張照片屬於哪一餐" }),
  ).toBeFocused();
  await expect(
    page.getByText("此班今天已有午餐資料，請選擇照片歸屬"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下一步：選擇餐盤" }),
  ).toBeDisabled();
});

test("可從餐期證據精確追加第 N 份餐盤且不改寫原秤重", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  const mealId = "meal-12-class-5a";

  await page.goto(`/records?meal=${mealId}`);
  const addPlateLink = page.getByRole("link", {
    name: "為此餐期新增餐盤",
  });
  await expect(addPlateLink).toHaveAttribute("href", `/scan?meal=${mealId}`);
  await page.evaluate(() => window.scrollTo(0, 320));
  await addPlateLink.click();

  await expect(page).toHaveURL(new RegExp(`/scan\\?meal=${mealId}$`));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByText("已鎖定指定餐期")).toBeVisible();
  await expect(page.getByText(/新增第3份餐盤/)).toBeVisible();
  await expect(page.getByText(/供應與剩食秤重均已鎖定/)).toBeVisible();
  await expect(page.getByLabel("日期", { exact: true })).toHaveValue(
    "2026-10-16",
  );
  await expect(page.getByLabel("日期", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("班級", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("主食", { exact: true })).toHaveValue("陽春麵");
  await expect(page.getByLabel("主食", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("總供應重量（kg）")).toBeDisabled();
  await expect(page.getByLabel("全班餐後剩食秤重（kg）")).toBeDisabled();

  await page.getByRole("button", { name: "下一步：選擇餐盤" }).click();
  await expect(
    page.getByRole("heading", { name: "拍攝或選擇剩食餐盤" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "直接建立人工判讀表" }).click();
  await expect(
    page.getByRole("heading", { name: "沒有模型也能建立可稽核資料" }),
  ).toBeFocused();
  await page.getByRole("checkbox", { name: /我已逐項人工檢查/ }).check();
  await page.getByRole("button", { name: "確認並寫入資料" }).click();
  await expect(page.getByText(mealId)).toBeVisible({ timeout: 20_000 });

  await page.goto("/records");
  const mealRow = page
    .getByRole("row")
    .filter({ hasText: "2026-10-16" })
    .filter({ hasText: "五年一班" })
    .filter({ hasText: "陽春麵・滷雞腿" });
  await expect(mealRow).toContainText("7.1 kg");
  await expect(mealRow).toContainText("1.4 kg");
  await expect(mealRow).toContainText("3 份");
});

test("餐期日誌可搜尋並依剩食程度篩選", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/records");
  const table = page.getByRole("table", { name: /每日餐期紀錄/ });
  await expect(table).toBeVisible({ timeout: 20_000 });

  const search = page.getByPlaceholder("搜尋主食、主菜或配菜");
  await search.fill("不存在的菜色");
  await expect(page.getByText("找不到符合條件的餐期")).toBeVisible();

  await search.fill("咖哩");
  await expect(page.locator(".filter-count")).not.toContainText("0 筆結果");
  await expect(table.getByRole("row").nth(1)).toContainText("咖哩");

  await page.getByLabel("剩食程度").selectOption("medium");
  await expect(page.locator(".filter-count")).not.toContainText("0 筆結果");
  const rates = await table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => {
      const matched = row.textContent?.match(/(\d+(?:\.\d+)?)%/);
      return matched ? Number(matched[1]) : NaN;
    }),
  );
  expect(rates.length).toBeGreaterThan(0);
  expect(rates.every((rate) => rate >= 15 && rate < 25)).toBe(true);
});

test("指定餐期深連結在使用頁內篩選後不再混入結果", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/records?meal=meal-01-class-5a");
  await expect(
    page.getByRole("link", { name: "為此餐期新增餐盤" }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByPlaceholder("搜尋主食、主菜或配菜").fill("不存在的菜色");

  await expect(page).toHaveURL(/\/records$/);
  await expect(page.locator(".filter-count")).toContainText("0 筆結果");
  await expect(page.getByText("找不到符合條件的餐期")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "為此餐期新增餐盤" }),
  ).toHaveCount(0);
});

test("餐期日誌分頁且舊餐期深連結會自動落在正確頁", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/records");
  await expect(page.getByText("顯示第 1–20 筆，共 48 筆")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".records-table tbody > tr")).toHaveCount(20);

  await page.getByRole("button", { name: "下一頁" }).click();
  await expect(page.getByText("顯示第 21–40 筆，共 48 筆")).toBeFocused();
  await page.getByRole("button", { name: "下一頁" }).click();
  await expect(page.getByText("顯示第 41–48 筆，共 48 筆")).toBeFocused();
  await expect(page.getByRole("button", { name: "下一頁" })).toBeDisabled();

  await page.goto("/records?meal=meal-01-class-5a");
  await expect(page.getByText("顯示第 41–48 筆，共 48 筆")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("link", { name: "為此餐期新增餐盤" }),
  ).toHaveAttribute("href", "/scan?meal=meal-01-class-5a");
});

test("供餐試算呈現證據並保存為後續改善實驗可用的情境", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/forecast");
  await expect(
    page.getByRole("heading", {
      name: "把過去的浪費，轉成有安全界線的下一餐建議",
    }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByLabel("預計用餐人數").fill("80");
  await page.getByLabel("菜色關鍵字").fill("咖哩飯｜雞肉咖哩");
  const plannedSupply = page.getByLabel("供餐比較基準");
  const eightyPeopleBaseline = Number(await plannedSupply.inputValue());
  await page.getByLabel("預計用餐人數").fill("40");
  const fortyPeopleBaseline = Number(await plannedSupply.inputValue());
  expect(fortyPeopleBaseline).toBeCloseTo(eightyPeopleBaseline / 2, 1);
  await page.getByLabel("預計用餐人數").fill("80");
  await page.getByLabel("供餐比較基準").fill("20");
  await page.getByRole("button", { name: "分析歷史紀錄" }).click();
  await expect(page.getByText("供餐參考")).toBeVisible();
  await expect(page.getByText("建議背後的歷史證據")).toBeVisible();

  await page.getByRole("button", { name: "保存這個決策情境" }).click();
  await expect(page.getByText("已保存的供餐情境")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".saved-predictions")).toContainText(
    "咖哩飯｜雞肉咖哩 · 80 人",
  );

  await page.getByRole("link", { name: "已保存・下一步建立改善實驗" }).click();
  await expect(
    page.getByRole("heading", { name: "定義比較期間與情境介入" }),
  ).toBeVisible();
  await expect(page.getByLabel("連結已保存的供餐情境（可選）")).toContainText(
    "咖哩飯｜雞肉咖哩 · 80 人",
  );
  await page.getByLabel("實驗名稱").fill("E2E 連結供餐建議實驗");
  await page.getByLabel("採用方式").selectOption("adjusted");
  await page.getByLabel("實際準備量").fill("18.5");
  await page
    .getByLabel("決策備註")
    .fill("營養師保留 1.5 kg 緩衝，先由單週餐期試行。");
  await page
    .getByLabel("介入方式")
    .fill("依保存的建議量進行小規模試行，再記錄實際採用量。");
  // New experiments record human review here. Quantitative safety outcomes are
  // entered per meal with sources and aggregated by the experiment's periods.
  await expect(page.getByLabel("缺餐／吃不飽回報人次")).toHaveCount(0);
  await expect(page.getByLabel("滿意度平均（1–5）")).toHaveCount(0);
  await page.getByLabel("營養師確認狀態").selectOption("confirmed");
  await page
    .getByLabel("營養師／午餐承辦備註")
    .fill("營養師確認保留現場補餐量後，可進行小規模試行。");
  await page
    .getByLabel("可能干擾因素（每行一項）")
    .fill("氣溫較低\n出席人數變動");
  await page.getByRole("button", { name: "建立並計算" }).click();
  const decisionTrace = page.getByLabel("供餐建議採用紀錄");
  await expect(decisionTrace).toContainText("咖哩飯｜雞肉咖哩", {
    timeout: 20_000,
  });
  await expect(decisionTrace).toContainText("調整後採用");
  await expect(decisionTrace).toContainText("原計畫");
  await expect(decisionTrace).toContainText("20.0 kg");
  await expect(decisionTrace).toContainText("18.5 kg");
  const guardrails = page.locator(".safety-guardrail-panel");
  await expect(guardrails).toContainText("營養師已確認");
  await expect(page.locator(".meal-safety-comparison")).toContainText(
    "只計入最新且與餐期一致的觀察",
  );
  await expect(page.locator(".meal-safety-comparison")).toContainText(
    "供應不足事件（缺餐回報）",
  );
  await guardrails
    .getByText("舊版實驗數值摘要（僅供歷史查閱）", { exact: true })
    .click();
  await expect(guardrails).toContainText("未納入上方前後護欄計算");
  await expect(guardrails.locator("details")).toContainText("未量測");
  await expect(guardrails).not.toContainText("4.4 / 5（30 份）");

  await page.reload();
  await page.getByRole("tab", { name: "E2E 連結供餐建議實驗" }).click();
  const restoredTrace = page.getByLabel("供餐建議採用紀錄");
  await expect(restoredTrace).toContainText("咖哩飯｜雞肉咖哩");
  await expect(restoredTrace).toContainText("調整後採用");
  await expect(restoredTrace).toContainText("18.5 kg");
  await expect(page.locator(".safety-guardrail-panel")).toContainText(
    "營養師已確認",
  );
  await expect(page.locator(".safety-guardrail-panel")).toContainText(
    "氣溫較低",
  );
});

test("改善實驗使用自身期間與班級，不被全站篩選清空", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/");
  await expect(page.getByLabel("班級篩選")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("班級篩選").selectOption("class-5a");
  await page.getByLabel("日期範圍").selectOption("month");
  await page.getByRole("link", { name: "改善實驗", exact: true }).click();

  const comparison = page.locator(".before-after-large");
  await expect(comparison).toContainText("27.1%", { timeout: 20_000 });
  await expect(comparison).toContainText("19.0%");
  await expect(page.getByText(/不會被頂部全站篩選悄悄改變/)).toBeVisible();
  await expect(page.getByText(/本實驗範圍｜全部班級/)).toBeVisible();
});

test("教師可建立有計算結果的改善實驗", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/experiments");
  await expect(
    page.getByRole("heading", { name: "不只看數字變小，也檢查比較是否公平" }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "建立實驗" }).click();
  await page.getByLabel("實驗名稱").fill("E2E 供餐改善驗證");
  await page
    .getByLabel("介入方式")
    .fill("先以較小供餐量試行，再記錄學生回饋。");
  await page.getByRole("button", { name: "建立並計算" }).click();

  const selectedExperiment = page.getByRole("tab", {
    name: "E2E 供餐改善驗證",
  });
  await expect(selectedExperiment).toHaveAttribute("aria-selected", "true", {
    timeout: 20_000,
  });
  await expect(page.getByText("情境前期")).toBeVisible();
  await expect(page.getByText("情境後期")).toBeVisible();
  await expect(page.getByText("這個結果還不能證明因果")).toBeVisible();
});

test("教師管理可下載 JSON、CSV，且 Demo reset 必須二次確認", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "把示範作品轉成可長期研究的校園工具" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "備份與重設" }).click();

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 JSON 完整備份" }).click();
  expect((await jsonDownload).suggestedFilename()).toBe(
    "foodlens-complete-backup-v1.json",
  );

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 CSV 餐期資料" }).click();
  expect((await csvDownload).suggestedFilename()).toBe(
    "foodlens-meal-records.csv",
  );

  const reset = page.getByRole("button", { name: "準備重設示範資料" });
  await reset.click();
  await expect(
    page.getByRole("button", { name: "再按一次確認重設" }),
  ).toBeVisible();
  await expect(page.getByText("8 秒後自動取消")).toBeVisible();
  await page.getByRole("button", { name: "再按一次確認重設" }).click();
  await expect(
    page.getByRole("button", { name: "準備重設示範資料" }),
  ).toBeVisible({
    timeout: 20_000,
  });
});

test("資料備份深連結會直接開啟正確管理分頁", async ({ page }) => {
  await page.goto("/admin?tab=data");
  await expect(page.getByRole("tab", { name: "備份與重設" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "匯出與還原" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /下載 JSON 完整備份/ }),
  ).toBeVisible();
});

test("768、1440、1920 的關鍵頁皆沒有水平溢位", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  const criticalRoutes = [
    "/",
    "/scan",
    "/records",
    "/forecast",
    "/experiments",
    "/admin",
  ];
  const viewports = [
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of criticalRoutes) {
      await page.goto(route);
      await expect(
        page.locator("main").getByRole("heading", { level: 1 }).first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }
  }
});
