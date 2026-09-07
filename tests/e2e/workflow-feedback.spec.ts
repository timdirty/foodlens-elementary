import { expect, test, type Page } from "@playwright/test";

// Every Playwright project gets its own fresh context/IndexedDB at the isolated
// test origin. These journeys never reuse an operator's localhost:3011 data.
const isolatedCaseUrl = "/workflow?case=demo-evidence-1";

function stageButton(page: Page, name: RegExp) {
  return page
    .getByRole("navigation", { name: "午餐任務四步驟" })
    .getByRole("button", { name });
}

async function openFeedback(page: Page) {
  await page.goto(isolatedCaseUrl);
  await expect(page.getByLabel("人工確認菜名").first()).toBeVisible({
    timeout: 20_000,
  });
  await stageButton(page, /學生原因/).click();
  await expect(page.getByLabel("匿名回覆收集狀態")).toBeVisible();
}

async function saveDecision(page: Page) {
  await page.getByRole("button", { name: "檢查並繼續" }).click();
  await expect(page.getByRole("group", { name: "責任決策輸入" })).toBeVisible();
  await page
    .getByRole("group", { name: "人工決策" })
    .getByRole("button", { name: "需要更多資料" })
    .click();
  await page
    .getByLabel("決策理由（至少 5 字）")
    .fill("隔離驗收：先記錄實際收集狀態，不以缺資料代填票數。");
  await page.getByRole("button", { name: "確認並保存證據鏈" }).click();
  await expect(
    page.locator('[role="status"]').filter({ hasText: "已保存於這個瀏覽器" }),
  ).toContainText("重新整理後仍會保留", { timeout: 20_000 });
}

for (const state of ["not-collected", "collected-zero"] as const) {
  test(`回饋 ${state} 可保存並重整，空白不變成零票或正常觀察`, async ({
    page,
  }) => {
    await openFeedback(page);
    await page.getByLabel("匿名回覆收集狀態").selectOption("not-collected");
    await expect(page.getByLabel("份量太多票數")).toHaveValue("");
    await expect(page.getByLabel("份量太多票數")).toBeDisabled();
    await page.getByLabel("配送延遲（分鐘）").fill("");
    await page
      .getByLabel("現場溫度觀察（僅作線索）")
      .selectOption("not-collected");

    if (state === "collected-zero") {
      await page.getByLabel("匿名回覆收集狀態").selectOption("collected");
      await expect(page.getByLabel("份量太多票數")).toHaveValue("");
      await page
        .getByRole("button", {
          name: "已收集但沒有回覆，全部記為 0 票",
        })
        .click();
      await expect(page.getByLabel("份量太多票數")).toHaveValue("0");
    }

    await saveDecision(page);
    const coverage = page.getByRole("region", {
      name: "回饋與現場觀察涵蓋率",
    });
    await expect(coverage).toContainText("共 0 份有效回覆");
    await expect(coverage).toContainText(
      state === "collected-zero" ? "1 筆確認為 0 份回覆" : "尚未收集 1 筆",
    );
    await expect(coverage).toContainText("配送延遲已觀察 0 筆");
    await expect(coverage).toContainText("溫度情境已觀察 0 筆");

    await page.reload();
    await expect(page.getByLabel("人工確認菜名").first()).toBeVisible({
      timeout: 20_000,
    });
    await stageButton(page, /學生原因/).click();
    await expect(page.getByLabel("匿名回覆收集狀態")).toHaveValue(
      state === "collected-zero" ? "collected" : "not-collected",
    );
    await expect(page.getByLabel("份量太多票數")).toHaveValue(
      state === "collected-zero" ? "0" : "",
    );
    await expect(page.getByLabel("配送延遲（分鐘）")).toHaveValue("");
    await expect(page.getByLabel("現場溫度觀察（僅作線索）")).toHaveValue(
      "not-collected",
    );
    await expect(page.getByText("目前顯示已正式保存的證據鏈")).toBeVisible();

    if (state === "not-collected") {
      // Follow the actual saved case -> linked meal -> first safety observation.
      // This is not a seeded revision and never creates a second meal manually.
      await page.getByRole("link", { name: "補記本餐安全觀察" }).click();
      const safety = page.getByRole("region", { name: "本餐安全觀察" });
      await expect(
        safety.getByRole("form", { name: "本餐安全觀察表單" }),
      ).toBeVisible();
      await expect(safety.getByLabel("供應不足事件次數")).toHaveValue("");
      await safety
        .getByRole("checkbox", { name: /我已核對收集狀態與來源/ })
        .check();
      await safety
        .getByRole("button", { name: "確認並保存本餐安全觀察" })
        .click();
      await expect(safety.getByText("最新保存：第 1 版")).toBeVisible();
      await page.reload();
      await expect(safety.getByText("最新保存：第 1 版")).toBeVisible();
      await expect(safety.getByLabel("供應不足收集狀態")).toHaveValue(
        "not-collected",
      );
    }
  });
}

test("部分票數草稿經鍵盤返回量測並重整後，可到回饋補欄而不被困住", async ({
  page,
}) => {
  await openFeedback(page);
  await page.getByLabel("匿名回覆收集狀態").selectOption("not-collected");
  await page.getByLabel("匿名回覆收集狀態").selectOption("collected");
  await page.getByLabel("份量太多票數").fill("0");
  await page.getByRole("button", { name: "檢查並繼續" }).click();
  await expect(
    page.getByRole("group", { name: "學生原因輸入" }).getByRole("alert"),
  ).toContainText("已收集時請逐項填寫票數；確認沒有票才填 0");
  await expect(
    page.getByRole("button", { name: "確認並保存證據鏈" }),
  ).toHaveCount(0);

  // Use the real keyboard to navigate back, then preserve this precise
  // incomplete state in IndexedDB rather than substituting a ready fixture.
  const measurementTab = stageButton(page, /分流秤重/);
  await measurementTab.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("備餐耗損毛重（公克）")).toBeVisible();
  await expect(
    page.getByText("未完成草稿已保存", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("備餐耗損毛重（公克）")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "檢查並繼續" }).click();
  await expect(page.getByLabel("匿名回覆收集狀態")).toHaveValue("collected");
  await page.getByRole("button", { name: /^味道不習慣/ }).click();
  await expect(page.getByLabel("味道不習慣票數")).toHaveValue("");
  await page.getByRole("button", { name: "檢查並繼續" }).click();
  await expect(
    page.getByRole("group", { name: "學生原因輸入" }).getByRole("alert"),
  ).toContainText("已收集時請逐項填寫票數");
  await page
    .getByRole("button", { name: "已收集但沒有回覆，全部記為 0 票" })
    .click();
  await expect(page.getByLabel("味道不習慣票數")).toHaveValue("0");
  await saveDecision(page);
  await expect(
    page.getByRole("region", { name: "回饋與現場觀察涵蓋率" }),
  ).toContainText("1 筆確認為 0 份回覆");
});
