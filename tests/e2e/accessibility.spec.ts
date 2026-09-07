import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/workflow",
  "/scan",
  "/records",
  "/lab",
  "/forecast",
  "/impact",
  "/trace",
  "/experiments",
  "/research",
  "/admin",
  "/presentation",
];

for (const route of routes) {
  test(`${route} 無重大 WCAG A/AA 問題且無水平溢位`, async ({ page }) => {
    await page.goto(route);
    await expect(
      page.locator("main").getByRole("heading", { level: 1 }).first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    );
    expect(
      serious.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => ({
          target: node.target.join(" "),
          failureSummary: node.failureSummary,
        })),
      })),
    ).toEqual([]);
  });
}

test("行動版保留資料與辨識徽章，並可由更多到達所有子頁", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/records");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 20_000,
  });

  await expect(page.locator(".status-pill.demo")).toBeVisible();
  await expect(page.locator(".status-pill.mock")).toBeVisible();

  const moreButton = page.getByRole("button", { name: "更多" });
  await expect(moreButton).toHaveClass(/active/);
  await moreButton.click();

  const expectedLinks = [
    "8 分鐘簡報",
    "餐期日誌",
    "供餐試算",
    "改善實驗",
    "永續影響",
    "去向追蹤",
    "教師管理",
  ];
  for (const name of expectedLinks) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "餐期日誌" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("390、768、1440、1920 四種展示尺寸皆保留關鍵狀態且無水平溢位", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "由 desktop 專案執行尺寸矩陣");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".status-pill.demo")).toBeVisible();
    await expect(page.locator(".status-pill.mock")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
});

test("768px 首頁改善循環的五個步驟都在可視範圍內", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "由 desktop 專案量測平板斷點");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");

  const story = page.getByRole("region", {
    name: "從這份餐盤，一路追到下一次量測",
  });
  await expect(story).toBeVisible({ timeout: 20_000 });
  const steps = story.getByRole("listitem");
  await expect(steps).toHaveCount(5);

  const geometry = await steps.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        width: box.width,
        viewportWidth: window.innerWidth,
      };
    }),
  );

  expect(geometry).toHaveLength(5);
  for (const step of geometry) {
    expect(step.width).toBeGreaterThan(0);
    expect(step.left).toBeGreaterThanOrEqual(0);
    expect(step.right).toBeLessThanOrEqual(step.viewportWidth);
  }
});

test("全域班級篩選跨頁保持，數字不會偷偷變回全校", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "跨頁範圍由桌機專案驗證一次");
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "班級篩選" })
    .selectOption("class-5a");
  await expect(page.locator(".hero-copy")).toContainText("12 筆班級餐期");
  await expect(page.locator(".hero-copy")).toContainText("24 份餐盤");

  await page.getByRole("link", { name: "餐期日誌" }).click();
  await expect(page.locator(".filter-count")).toContainText("12 筆結果");

  await page.getByRole("link", { name: "永續影響" }).click();
  await expect(page.locator(".impact-kpis")).toContainText("12 筆模擬餐期");
});

test("8 分鐘簡報可用按鈕與鍵盤走完八段敘事", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "避免在兩個專案重複計時流程");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/presentation");
  await expect(
    page.getByRole("main", { name: "FoodLens 評審模式預檢" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "以示範身分預覽" }).click();
  await expect(page.getByRole("heading", { name: /剩下來的午餐/ })).toBeVisible(
    { timeout: 20_000 },
  );
  const presentationToolbar = page.locator("header").first();
  await expect(presentationToolbar).toContainText("示範資料");
  await expect(presentationToolbar).toContainText("辨識：示範規則");

  await page.getByRole("button", { name: /開始計時/ }).click();
  await expect(page.getByRole("button", { name: /暫停/ })).toBeFocused();
  // Global slide shortcuts must not hijack focused controls.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("1 / 8", { exact: true })).toBeVisible();

  const slideTitles = [
    /能行動的證據/,
    /兩個閉環/,
    /學生保留最後判斷權/,
    /刻意設計情境/,
    /決定仍然交給學校/,
    /示範如何避免誇大/,
    /更有依據地負責/,
  ];
  for (const [index, title] of slideTitles.entries()) {
    if (index % 2 === 0) {
      // Clicking the slide surface leaves the focused toolbar control.
      await page.getByRole("heading", { level: 1 }).click();
      await page.keyboard.press("ArrowRight");
    } else {
      await page.getByRole("button", { name: "下一頁", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      page.getByText(`${index + 2} / 8`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `前往第 ${index + 2} 頁` }),
    ).toHaveAttribute("aria-current", "step");
  }
  await expect(
    page.getByRole("button", { name: "下一頁", exact: true }),
  ).toBeDisabled();
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("Home");
  await expect(page.getByText("1 / 8", { exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("heading", { name: /更有依據地負責/ }),
  ).toBeVisible();
  await expect(page.getByText("8 / 8", { exact: true })).toBeVisible();
});

test("390px 簡報保留八個可觸控跳頁按鈕", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/presentation");
  await page.getByRole("button", { name: "以示範身分預覽" }).click();
  await expect(page.getByRole("heading", { name: /剩下來的午餐/ })).toBeVisible(
    { timeout: 20_000 },
  );

  const jumpButtons = page.getByRole("button", { name: /前往第 \d+ 頁/ });
  await expect(jumpButtons).toHaveCount(8);
  for (const button of await jumpButtons.all()) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("button", { name: "前往第 8 頁" }).click();
  await expect(page.getByText("8 / 8", { exact: true })).toBeVisible();
});

test("決選排練可切換 5 分鐘提問與 7 分鐘答詢", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "排練流程由桌機專案驗證一次");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/presentation");
  await page.getByRole("button", { name: "以示範身分預覽" }).click();

  await page.getByRole("button", { name: "5 分鐘統一提問" }).click();
  await expect(
    page.getByRole("heading", { name: "先把問題聽完整，再決定怎麼回答" }),
  ).toBeVisible();
  await expect(page.getByText("這一段先不顯示答案")).toBeVisible();
  await expect(page.getByText(/題庫只供排練/)).toBeVisible();

  await page.getByRole("button", { name: "7 分鐘團隊答詢" }).click();
  await expect(
    page.getByRole("heading", { name: "先回答、再舉證，最後主動說限制" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "顯示答案重點" }).click();
  await expect(
    page.getByText("不能精確秤重；影像只提供可修正的比例初判。"),
  ).toBeVisible();
  await expect(page.getByText("誠實邊界", { exact: true })).toBeVisible();
});

test("30 秒導覽使用原生對話框，Esc 關閉後回到啟動按鈕", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  const opener = page.getByRole("button", { name: "30 秒研究摘要" });
  await expect(opener).toBeVisible({ timeout: 20_000 });
  await opener.focus();
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "30 秒看懂 FoodLens" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty("open", true);
  const closeButton = dialog.getByRole("button", { name: "關閉導覽" });
  await expect(closeButton).toBeFocused();

  const stepMap = dialog.getByRole("list", { name: "FoodLens 六步驟循環" });
  await expect(stepMap.getByRole("button")).toHaveCount(6);
  const steps = [
    ["看見問題", "查看控制中心", "/", "48 筆模擬餐期"],
    ["把一餐的證據接起來", "進入午餐任務台", "/workflow", "每一步都保留來源"],
    ["辨識先整理，學生確認", "實際掃描餐盤", "/scan", "不代表真實 AI 效能"],
    ["從資料找規律", "查看數據實驗室", "/lab", "樣本門檻"],
    [
      "追到最終去向",
      "查看廚餘去向證據",
      "/trace",
      "沒有核驗收據，就不宣稱實際去向",
    ],
    ["驗證改善，再評估擴大", "查看前後比較情境", "/experiments", "不當成成果"],
  ];
  const detail = dialog.locator("#tour-step-detail");
  for (const [title, cta, href, boundary] of steps) {
    const stepButton = stepMap.getByRole("button", { name: new RegExp(title) });
    await stepButton.click();
    await expect(stepButton).toHaveAttribute("aria-pressed", "true");
    await expect(stepMap.locator('button[aria-pressed="true"]')).toHaveCount(1);
    await expect(detail).toContainText(title);
    await expect(detail).toContainText(boundary);
    await expect(detail.getByRole("link", { name: cta })).toHaveAttribute(
      "href",
      href,
    );
  }
  await expect(
    dialog.getByRole("link", { name: "親手掃描一張餐盤" }),
  ).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await closeButton.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("link", { name: "親手掃描一張餐盤" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();
    const focusableCount = await dialog.locator("button, a[href]").count();
    for (let index = 0; index < focusableCount + 2; index += 1) {
      await page.keyboard.press("Tab");
      await expect
        .poll(() =>
          page.evaluate(() => {
            const active = document.activeElement;
            const modal = document.querySelector("dialog[open]");
            return Boolean(active && modal?.contains(active));
          }),
        )
        .toBe(true);
    }
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("餐期列表使用真實表格語意，手機預設改用卡片", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/records");
  const table = page.getByRole("table", { name: /每日餐期紀錄/ });
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(table.getByRole("columnheader")).toHaveCount(7);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".record-card").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(table).toHaveCount(0);
});

test("圖表名稱不重複、替代表格有標題與欄頭，且減少動畫設定有效", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/lab");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 20_000,
  });

  const chartLabels = await page
    .locator('[role="img"][aria-label]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    );
  expect(new Set(chartLabels).size).toBe(chartLabels.length);
  await expect(page.locator('.chart-box svg[role="application"]')).toHaveCount(
    0,
  );
  await expect(page.locator('.chart-box svg[tabindex="0"]')).toHaveCount(0);

  const dailyPanel = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "示範情境 8 週每日剩食率",
      exact: true,
    }),
  });
  await expect(dailyPanel).toHaveCount(1);
  await dailyPanel.getByText("查看資料表", { exact: true }).click();
  const dataTable = dailyPanel.getByRole("table", {
    name: "示範情境 8 週每日加權剩食率資料",
    exact: true,
  });
  await expect(dataTable).toBeVisible();
  await expect(dataTable.getByRole("columnheader")).toHaveCount(3);
  await expect(dataTable.getByRole("columnheader")).toHaveText([
    "日期",
    "加權剩食率",
    "餐期數",
  ]);
  await expect(dataTable.getByRole("rowheader")).toHaveCount(12);

  await page.goto("/");
  await page.getByRole("button", { name: "30 秒研究摘要" }).click();
  const reducedMotion = await page.locator(".tour-dialog").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(reducedMotion).toEqual({
    animationDuration: "0s",
    transitionDuration: "0s",
  });

  await page.goto("/impact");
  const presetButtons = page.locator(".range-wrap button");
  await expect(presetButtons).toHaveCount(4);
  for (const button of await presetButtons.all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});

test("教師管理分頁支援 roving tabindex 與完整鍵盤操作", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 20_000,
  });

  const launchTab = page.getByRole("tab", { name: "啟用中心" });
  const projectTab = page.getByRole("tab", { name: "專案資料" });
  const cloudTab = page.getByRole("tab", { name: "校園雲端" });
  await expect(launchTab).toHaveAttribute("tabindex", "0");
  await expect(projectTab).toHaveAttribute("tabindex", "-1");

  await launchTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(projectTab).toBeFocused();
  await expect(projectTab).toHaveAttribute("aria-selected", "true");
  await expect(projectTab).toHaveAttribute("tabindex", "0");
  await expect(launchTab).toHaveAttribute("tabindex", "-1");

  await page.keyboard.press("End");
  await expect(cloudTab).toBeFocused();
  await expect(cloudTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(launchTab).toBeFocused();
  await expect(launchTab).toHaveAttribute("aria-selected", "true");

  const tabs = page
    .getByRole("tablist", { name: "教師管理區段" })
    .getByRole("tab");
  for (const tab of await tabs.all()) {
    const panelId = await tab.getAttribute("aria-controls");
    if (!panelId) throw new Error("教師管理分頁缺少 aria-controls");
    const tabId = await tab.getAttribute("id");
    if (!tabId) throw new Error("教師管理分頁缺少 id");
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", tabId);
  }
});

test("改善實驗分頁與內容面板具有可解析的 ARIA 關聯", async ({ page }) => {
  await page.goto("/experiments");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 20_000,
  });

  const tabs = page.getByRole("tablist", { name: "改善實驗" }).getByRole("tab");
  await expect(tabs.first()).toHaveAttribute("tabindex", "0");
  for (const tab of await tabs.all()) {
    const panelId = await tab.getAttribute("aria-controls");
    if (!panelId) throw new Error("改善實驗分頁缺少 aria-controls");
    const tabId = await tab.getAttribute("id");
    if (!tabId) throw new Error("改善實驗分頁缺少 id");
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", tabId);
  }
});
