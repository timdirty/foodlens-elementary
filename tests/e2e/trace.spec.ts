import { expect, test } from "@playwright/test";

test("示範清運可從待交接一路完成收據核驗，重新整理後仍保留", async ({
  page,
}) => {
  await page.goto("/trace");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "追到收據，才知道廚餘最後去了哪裡",
    }),
  ).toBeVisible({ timeout: 20_000 });

  await expect(
    page.getByRole("heading", { level: 2, name: "完成交接證據" }),
  ).toBeVisible();
  await page.getByLabel("校方交接淨重（g）").fill("6800");
  await page.getByRole("button", { name: "檢查交接資料" }).click();
  await page
    .getByRole("checkbox", { name: /我已對照現場交接或處理場收據/ })
    .check();
  await page.getByRole("button", { name: "確認寫入" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "登錄處理場收據" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "檢查申報資料" }).click();
  await page
    .getByRole("checkbox", { name: /我已對照現場交接或處理場收據/ })
    .check();
  await page.getByRole("button", { name: "確認寫入" }).click();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "核驗收據，不替處理場補答案",
    }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("選取處理場收據原檔").setInputFiles({
    name: "demo-facility-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nFoodLens demo facility receipt\n%%EOF"),
  });
  await expect(page.getByText(/SHA-256 [0-9a-f]{16}…/)).toBeVisible();
  await page.getByRole("button", { name: "檢查核驗內容" }).click();
  await page
    .getByRole("checkbox", { name: /我已對照現場交接或處理場收據/ })
    .check();
  await page.getByRole("button", { name: "確認寫入" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "這批資料已完成四段證據" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText("實際處理", { exact: true }).first(),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 2, name: "這批資料已完成四段證據" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("去向已核驗").first()).toBeVisible();
});

test("錯誤安排可取消，收據不符可附原因退回後重新申報", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "異常閉環由桌機情境驗證一次");
  await page.goto("/trace");
  await expect(
    page.getByRole("heading", { level: 2, name: "完成交接證據" }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "取消這筆安排" }).click();
  await expect(page.getByText("確認取消這筆尚未交接的安排")).toBeVisible();
  await page
    .getByRole("checkbox", { name: /我確認這筆安排尚未發生實際交接/ })
    .check();
  await page.getByRole("button", { name: "確認寫入" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "這筆清運已取消" }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /查看 2026\/09\/18/ }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "核驗收據，不替處理場補答案",
    }),
  ).toBeVisible();
  await page
    .getByLabel(/收據不完整或內容不符/)
    .fill("收料重量與原始入場單不符，請重新提供文件");
  await page.getByRole("button", { name: "檢查退回原因" }).click();
  await page.getByRole("checkbox", { name: /我確認收據確實不合格/ }).check();
  await page.getByRole("button", { name: "確認寫入" }).click();
  await expect(page.getByText("上一張收據已退回")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("heading", { level: 2, name: "登錄處理場收據" }),
  ).toBeVisible();
});
