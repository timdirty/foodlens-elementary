import { expect, test } from "@playwright/test";

test("Demo 掃描、人工確認、保存、重整與餐期追溯形成完整循環", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "寫入流程只需在隔離桌機情境驗證一次",
  );

  await page.goto("/scan");
  await expect(
    page.getByRole("heading", { name: "影像先整理，學生做最後確認" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("餐盤觀察表｜No. 097")).toBeVisible();

  const scanDate = "2026-10-26";
  await page.getByLabel("日期", { exact: true }).fill(scanDate);
  await page.getByLabel("主食", { exact: true }).fill("白飯");
  await page.getByLabel("主菜", { exact: true }).fill("咖哩雞肉");
  await page.getByLabel("配菜（用頓號分隔）").fill("青花菜、玉米");
  await page.getByRole("button", { name: "下一步：選擇餐盤" }).click();
  await expect(page.getByText("辨識方式")).toBeVisible();
  await page.getByRole("button", { name: "開始示範辨識" }).click();

  await expect(
    page.getByRole("heading", { name: "逐項檢查影像初判" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("slider").first().fill("73");
  await expect(page.getByText("已人工修正").first()).toBeVisible();
  const humanCheck = page.getByRole("checkbox", {
    name: /我已逐項人工檢查/,
  });
  await expect(
    page.getByRole("button", { name: "確認並寫入資料" }),
  ).toBeDisabled();
  await humanCheck.check();
  await page.getByRole("button", { name: "確認並寫入資料" }).click();

  await expect(
    page.getByRole("heading", { name: "掃描紀錄建立完成" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("此瀏覽器 IndexedDB")).toBeVisible();

  await page.goto("/");
  await expect(page.locator(".status-pill.demo")).toContainText("49 餐期");
  await expect(
    page.getByRole("heading", { name: "最易剩的菜單 Top 5" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "食物類別剩餘組成" }),
  ).toBeVisible();
  await expect(
    page.locator(".kpi-card").filter({ hasText: "情境最近 7 天剩食量" }),
  ).toContainText("加權剩食率");
  await page.getByLabel("日期範圍").selectOption("all");
  await expect(
    page
      .locator(".kpi-card")
      .filter({ hasText: "已分析餐盤" })
      .getByLabel("97"),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".status-pill.demo")).toContainText("49 餐期");

  await page.goto("/records");
  const newMealRow = page.getByRole("row").filter({
    hasText: scanDate,
  });
  await expect(newMealRow).toContainText("咖哩雞肉");
  await expect(newMealRow).toContainText("1.2 kg");
  await page
    .getByRole("button", {
      name: new RegExp(`展開${scanDate} 咖哩雞肉的影像判讀與人工證據`),
    })
    .click();
  await expect(page.getByText("已人工修正 1 項 · AI 原始值保留")).toBeVisible();
});

test("午餐任務台從菜單人工確認走到責任決策，重新整理後仍可追溯", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "完整寫入流程只需在隔離桌機情境驗證一次",
  );

  await page.goto("/workflow");
  await expect(
    page.getByRole("heading", { name: "午餐任務台", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /^示範菜單/ }).click();
  await page.getByLabel("示範案例代號（可留空）").fill("e2e-evidence-chain");
  await page.getByRole("button", { name: "載入示範菜單" }).click();

  const correctedDishName = "學生確認版糙米飯";
  const originalDishName = await page
    .getByLabel("原始菜名（完整保留）")
    .first()
    .inputValue();
  const firstConfirmedName = page.getByLabel("人工確認菜名").first();
  await firstConfirmedName.fill(correctedDishName);
  await expect(firstConfirmedName).toHaveValue(correctedDishName);
  expect(originalDishName).not.toBe(correctedDishName);

  // OCR drafts retain unknown fields. Every dish must be explicitly reviewed
  // before the confirmation action becomes available; changing its name alone
  // does not attest the other low-confidence fields.
  await expect(
    page.getByRole("button", { name: "尚有 5 道待核對" }),
  ).toBeDisabled();
  const dishReviews = page.getByRole("checkbox", {
    name: "我已核對這道菜的低信心欄位；查不到的資料仍以「未知」保存。",
    exact: true,
  });
  await expect(dishReviews).toHaveCount(5);
  for (const review of await dishReviews.all()) {
    await review.check();
    await expect(review).toBeChecked();
  }
  await expect(
    page.getByRole("button", { name: "確認這份菜單", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "確認這份菜單" }).click();
  await expect(page.getByText("人工已確認", { exact: true })).toBeVisible();
  await expect(firstConfirmedName).toBeDisabled();
  await expect(page.getByLabel("原始菜名（完整保留）").first()).toHaveValue(
    originalDishName,
  );
  await page.getByRole("button", { name: /檢查並繼續/ }).click();

  await expect(
    page.getByRole("heading", { name: "把「剩很多」拆成五個來源" }),
  ).toBeVisible();
  for (const sourceName of [
    "備餐耗損",
    "未供出可食餐點",
    "餐盤可食剩食",
    "不可食部分",
    "湯汁／混雜物",
  ]) {
    await expect(page.getByText(sourceName, { exact: true })).toBeVisible();
  }
  await page.getByLabel("備餐耗損毛重（公克）").fill("430");
  await page.getByRole("button", { name: /檢查並繼續/ }).click();

  await expect(
    page.getByRole("heading", { name: "讓學生補上重量說不出的原因" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^份量太多 ·/ }).click();
  await page.getByLabel("份量太多票數").fill("6");
  await expect(
    page.getByRole("button", { name: "份量太多 · 6 票" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /檢查並繼續/ }).click();

  await expect(
    page.getByRole("heading", {
      name: "把規律轉成有主責、有護欄的下一步",
    }),
  ).toBeVisible();
  const responsibilityChoice = page
    .getByRole("button", { name: "針對這張卡做決定" })
    .first();
  await expect(responsibilityChoice).toBeVisible();
  await responsibilityChoice.click();
  const humanDecision = page.getByRole("group", { name: "人工決策" });
  await humanDecision.getByRole("button", { name: "這次不採用" }).click();
  await expect(
    humanDecision.getByRole("button", { name: "這次不採用" }),
  ).toHaveAttribute("aria-pressed", "true");
  const finalReviewer = page.getByLabel("最後確認角色");
  await finalReviewer.selectOption({ label: "午餐秘書" });
  await expect(finalReviewer).toHaveValue("lunch-secretary");
  await page
    .getByLabel("決策理由（至少 5 字）")
    .fill("由營養師先檢查營養與食安條件，再決定是否調整。");
  await page.getByRole("button", { name: "確認並保存證據鏈" }).click();

  const savedState = page
    .locator('[role="status"]')
    .filter({ hasText: "已保存於這個瀏覽器" });
  await expect(savedState).toContainText("重新整理後仍會保留", {
    timeout: 20_000,
  });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "午餐任務台", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("人工確認菜名").first()).toHaveValue(
    correctedDishName,
  );
  await expect(page.getByLabel("原始菜名（完整保留）").first()).toHaveValue(
    originalDishName,
  );
  await expect(page.getByText("人工已確認", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /責任決策/ }).click();
  await expect(page.getByLabel("最後確認角色")).toHaveValue("lunch-secretary");
  await expect(
    page.getByLabel("最後確認角色").locator("option:checked"),
  ).toHaveText("午餐秘書");
  await expect(
    page.locator('[role="status"]').filter({
      hasText: "已保存於這個瀏覽器",
    }),
  ).toContainText("重新整理後仍會保留");
});

test("午餐任務台在 390px 無水平溢位，頁尾操作不被手機導覽遮住", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "由 desktop 專案統一執行 390px 斷點回歸",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workflow");
  await expect(
    page.getByRole("heading", { name: "午餐任務台", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);

  const mobileNav = page.locator(".mobile-nav");
  const finalSection = page.locator('section[aria-label="下一段操作"]');
  await expect(mobileNav).toBeVisible();
  await expect(finalSection).toBeVisible();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.ceil(window.scrollY + innerHeight) >=
          document.documentElement.scrollHeight - 1,
      ),
    )
    .toBe(true);

  const geometry = await page.evaluate(() => {
    const lastBlock = document.querySelector<HTMLElement>(
      'section[aria-label="下一段操作"]',
    );
    const navigation = document.querySelector<HTMLElement>(".mobile-nav");
    if (!lastBlock || !navigation) throw new Error("找不到頁尾區塊或手機導覽");
    return {
      lastBlockBottom: lastBlock.getBoundingClientRect().bottom,
      navigationTop: navigation.getBoundingClientRect().top,
    };
  });
  expect(geometry.lastBlockBottom).toBeLessThanOrEqual(
    geometry.navigationTop + 1,
  );
});

test("午餐任務台在自動保存倒數內切換案件也不遺失最後一次編輯", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "IndexedDB 快速切案只需在隔離桌機情境驗證一次",
  );

  const caseId = "workflow-demo-2026-10-23-class-6a";
  await page.goto(`/workflow?case=${caseId}&class=class-6a&date=2026-10-23`);
  await expect(
    page.getByRole("heading", { name: "午餐任務台", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /^示範菜單/ }).click();
  const demoToken = page.getByLabel("示範案例代號（可留空）");
  await demoToken.fill("rapid-switch-last-edit");

  const selector = page.getByLabel("目前案件");
  const fallbackCaseId = await selector
    .locator("option")
    .evaluateAll(
      (options, currentCaseId) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .find((value) => value !== currentCaseId),
      caseId,
    );
  expect(fallbackCaseId).toBeTruthy();
  await selector.selectOption(fallbackCaseId!);
  await expect(page).toHaveURL(
    new RegExp(`case=${encodeURIComponent(fallbackCaseId!)}`),
  );

  await page.getByLabel("目前案件").selectOption(caseId);
  await expect(page).toHaveURL(new RegExp(`case=${caseId}`));
  await expect(page.getByLabel("示範案例代號（可留空）")).toHaveValue(
    "rapid-switch-last-edit",
  );
});
