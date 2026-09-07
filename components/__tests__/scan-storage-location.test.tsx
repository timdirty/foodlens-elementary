// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScanStorageLocation } from "@/components/scan-storage-location";

afterEach(cleanup);

describe("ScanStorageLocation", () => {
  it.each([
    ["cloud", "學校私有 Supabase 空間"],
    ["indexeddb", "此瀏覽器 IndexedDB"],
    ["memory", "暫存記憶體"],
  ] as const)("labels %s storage honestly", (storageMode, label) => {
    render(<ScanStorageLocation storageMode={storageMode} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("warns that memory data disappears after reload", () => {
    render(<ScanStorageLocation storageMode="memory" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "重新整理或關閉頁面後會遺失。",
    );
  });

  it("does not show the loss warning for persistent storage", () => {
    render(<ScanStorageLocation storageMode="indexeddb" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
