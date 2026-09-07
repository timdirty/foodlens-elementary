// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useConfirmationFocus } from "@/components/trace/use-confirmation-focus";

afterEach(cleanup);

function FocusHarness() {
  const [reviewing, setReviewing] = useState(false);
  const { setReviewElement, setReturnFocusElement, returnToEditor } =
    useConfirmationFocus(reviewing);

  return reviewing ? (
    <section ref={setReviewElement} aria-label="送出前確認" tabIndex={-1}>
      <button
        type="button"
        onClick={() => returnToEditor(() => setReviewing(false))}
      >
        返回修改
      </button>
    </section>
  ) : (
    <button
      ref={setReturnFocusElement}
      type="button"
      onClick={() => setReviewing(true)}
    >
      檢查資料
    </button>
  );
}

describe("useConfirmationFocus", () => {
  it("focuses the review on entry and restores the originating control on return", () => {
    render(<FocusHarness />);

    fireEvent.click(screen.getByRole("button", { name: "檢查資料" }));
    expect(screen.getByRole("region", { name: "送出前確認" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(screen.getByRole("button", { name: "檢查資料" })).toHaveFocus();
  });
});
