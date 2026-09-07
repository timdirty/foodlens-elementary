import { expect, test, type Locator, type Page } from "@playwright/test";

// This suite uses a fresh context at the isolated 127.0.0.1:3311 origin.
// The Demo seed has one safety observation for each seeded meal; changes append
// revisions instead of deleting the fixture or touching an operator's browser.
const safetyUrl = "/records?meal=meal-01-class-5a&safety=1";

async function openSafety(page: Page) {
  await page.goto(safetyUrl);
  const safety = page.getByRole("region", { name: "本餐安全觀察" });
  await expect(
    safety.getByRole("form", { name: "本餐安全觀察表單" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(safety.getByText("最新保存：第 1 版")).toBeVisible();
  return safety;
}

async function assertNoPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function assertFocusedControlIsUnobscured(control: Locator) {
  await expect(control).toBeFocused();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const inset = Math.min(4, rect.height / 4);
        const yPositions = [
          rect.top + inset,
          rect.top + rect.height / 2,
          rect.bottom - inset,
        ];
        return {
          withinViewport:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight,
          unobscured: yPositions.every((y) => {
            const hit = document.elementFromPoint(x, y);
            return hit === element || (hit !== null && element.contains(hit));
          }),
        };
      }),
    )
    .toEqual({ withinViewport: true, unobscured: true });
}

test("本餐安全觀察區分零事件與未收集，鍵盤保存修訂並重整後保留完整歷史", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const safety = await openSafety(page);
  await safety.getByLabel("供應不足收集狀態").selectOption("not-collected");
  await expect(safety.getByLabel("供應不足事件次數")).toHaveValue("");
  await safety.getByLabel("供應不足收集狀態").selectOption("recorded");
  await safety.getByLabel("供應不足事件次數").fill("0");
  await safety.getByLabel("供應不足觀察人數").fill("1");
  await safety.getByLabel("添餐收集狀態").selectOption("not-collected");
  await safety.getByLabel("添餐收集狀態").selectOption("recorded");
  await safety.getByLabel("添餐事件次數").fill("2");
  await safety.getByLabel("添餐觀察人數").fill("1");
  await safety.getByLabel("滿意度收集狀態").selectOption("not-collected");
  await safety.getByLabel("滿意度收集狀態").selectOption("collected");
  await safety.getByLabel("滿意度邀請人數").fill("3");
  await expect(safety.getByLabel("滿意度 5 分票數")).toHaveValue("");
  await safety
    .getByRole("button", { name: "已邀請但沒有回覆，五項記為 0 票" })
    .click();
  await safety.getByLabel("滿意度 5 分票數").fill("4");
  await safety.getByLabel("資料來源名稱").fill("隔離驗收單餐量測表");
  await safety
    .getByLabel("來源編號／查核位置")
    .fill("FL-E2E-SAFETY-001，第 2 頁");
  await safety
    .getByLabel("本次修訂原因")
    .fill("隔離驗收：補齊本餐安全觀察，保留原版。");
  await safety
    .getByRole("checkbox", { name: /我已核對收集狀態與來源/ })
    .check();
  await safety.getByRole("button", { name: "確認並保存本餐安全觀察" }).click();
  await expect(safety.getByRole("alert")).toContainText("票數不可高於邀請人次");
  await expect(safety.getByLabel("滿意度 5 分票數")).toHaveValue("4");
  await expect(safety.getByRole("alert")).toBeFocused();
  await safety
    .getByRole("button", { name: "已邀請但沒有回覆，五項記為 0 票" })
    .click();
  await safety
    .getByRole("checkbox", { name: /我已核對收集狀態與來源/ })
    .check();
  await assertNoPageOverflow(page);
  const submit = safety.getByRole("button", { name: "確認並保存本餐安全觀察" });
  await submit.scrollIntoViewIfNeeded();
  await submit.focus();
  await page.screenshot({
    path: testInfo.outputPath("meal-safety-submit-viewport.png"),
    fullPage: false,
  });
  // Check the actual viewport, not an element screenshot that can include
  // sticky bars across a tall capture. Hit-test the top, middle and bottom of
  // the control without assuming fixed header or mobile-navigation heights.
  await assertFocusedControlIsUnobscured(submit);
  await page.keyboard.press("Enter");
  await expect(
    safety.getByRole("status").filter({ hasText: "第 2 版已保存" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(safety.getByText("最新保存：第 2 版")).toBeVisible();
  await expect(
    safety.getByRole("button", { name: "新增修訂版安全觀察" }),
  ).toBeFocused();

  await page.reload();
  await expect(safety.getByText("最新保存：第 2 版")).toBeVisible({
    timeout: 20_000,
  });
  await expect(safety.getByLabel("供應不足事件次數")).toHaveValue("0");
  await expect(safety.getByLabel("添餐事件次數")).toHaveValue("2");
  await expect(safety.getByLabel("滿意度邀請人數")).toHaveValue("3");
  await expect(safety.getByLabel("滿意度 5 分票數")).toHaveValue("0");
  await safety.getByText("查看安全觀察歷史（2 版）").click();
  await expect(
    safety.getByRole("heading", { name: /^第 1 版 ·/ }),
  ).toBeVisible();
  await expect(
    safety.getByRole("heading", { name: /^第 2 版 ·/ }),
  ).toBeVisible();
  await expect(safety.getByText(/FL-E2E-SAFETY-001/)).toBeVisible();
  await assertNoPageOverflow(page);
});

test("安全比較表保留可讀欄寬與儲存格留白，窄螢幕可用鍵盤在表內橫向捲動", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/experiments");
  const tableRegion = page.getByRole("region", {
    name: "前後逐餐安全護欄比較表，可水平捲動",
  });
  await expect(tableRegion).toBeVisible({ timeout: 20_000 });
  await expect(
    tableRegion.getByRole("columnheader", { name: "基準期", exact: true }),
  ).toBeVisible();
  const metrics = await tableRegion.evaluate((region) => {
    const table = region.querySelector("table")!;
    const cell = table.querySelector("td")!;
    const style = getComputedStyle(cell);
    return {
      clientWidth: region.clientWidth,
      scrollWidth: region.scrollWidth,
      overflowX: getComputedStyle(region).overflowX,
      tableMinimumWidth: parseFloat(getComputedStyle(table).minWidth),
      cellPaddingTop: parseFloat(style.paddingTop),
      cellPaddingBottom: parseFloat(style.paddingBottom),
      cellPaddingLeft: parseFloat(style.paddingLeft),
      cellPaddingRight: parseFloat(style.paddingRight),
    };
  });
  expect(metrics.tableMinimumWidth).toBeGreaterThanOrEqual(800);
  expect(metrics.cellPaddingTop).toBeGreaterThanOrEqual(8);
  expect(metrics.cellPaddingBottom).toBeGreaterThanOrEqual(8);
  expect(metrics.cellPaddingLeft).toBeGreaterThanOrEqual(12);
  expect(metrics.cellPaddingRight).toBeGreaterThanOrEqual(12);
  expect(["auto", "scroll"]).toContain(metrics.overflowX);
  if ((page.viewportSize()?.width ?? 0) <= 768) {
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 1);
  }

  await tableRegion.scrollIntoViewIfNeeded();
  await tableRegion.focus();
  // Reach the region through a real Tab transition, not only programmatic focus.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(tableRegion).toBeFocused();
  const focusStyle = await tableRegion.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);
  expect(focusStyle.style).not.toBe("none");
  if (metrics.scrollWidth > metrics.clientWidth + 1) {
    const start = await tableRegion.evaluate((element) => element.scrollLeft);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => tableRegion.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(start);
  }
  await assertNoPageOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("meal-safety-comparison-viewport.png"),
    fullPage: false,
  });
});

test("明確未收集可以保存，不會補成零事件或滿意度零票", async ({ page }) => {
  const safety = await openSafety(page);
  await safety.getByLabel("供應不足收集狀態").selectOption("not-collected");
  await safety.getByLabel("添餐收集狀態").selectOption("not-collected");
  await safety.getByLabel("滿意度收集狀態").selectOption("not-collected");
  await safety.getByLabel("資料來源名稱").fill("");
  await safety.getByLabel("來源編號／查核位置").fill("");
  await safety
    .getByLabel("本次修訂原因")
    .fill("隔離驗收：這一餐未安排觀察，不推定成零。");
  await expect(safety.getByLabel("供應不足事件次數")).toBeDisabled();
  await expect(safety.getByLabel("添餐事件次數")).toHaveValue("");
  await expect(safety.getByLabel("滿意度 1 分票數")).toHaveValue("");
  await safety
    .getByRole("checkbox", { name: /我已核對收集狀態與來源/ })
    .check();
  await safety.getByRole("button", { name: "確認並保存本餐安全觀察" }).click();
  await expect(safety.getByText("最新保存：第 2 版")).toBeVisible({
    timeout: 20_000,
  });
  await page.reload();
  await expect(safety.getByLabel("供應不足收集狀態")).toHaveValue(
    "not-collected",
    { timeout: 20_000 },
  );
  await expect(safety.getByLabel("供應不足事件次數")).toHaveValue("");
  await expect(safety.getByLabel("添餐觀察人數")).toHaveValue("");
  await expect(safety.getByLabel("滿意度邀請人數")).toHaveValue("");
  await expect(safety.getByLabel("滿意度 5 分票數")).toHaveValue("");
  await expect(
    safety
      .locator("div")
      .filter({ has: page.getByText("最新保存：第 2 版", { exact: true }) })
      .last(),
  ).toContainText("滿意度：尚未收集");
  await assertNoPageOverflow(page);
});
