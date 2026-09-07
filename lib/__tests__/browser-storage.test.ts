import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserStorage,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
} from "@/lib/browser-storage";

describe("瀏覽器儲存降級", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Web Storage getter 被管理政策封鎖時不讓啟動流程崩潰", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new DOMException("blocked", "SecurityError");
      },
      get sessionStorage() {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    expect(getBrowserStorage("local")).toBeUndefined();
    expect(getBrowserStorage("session")).toBeUndefined();
  });

  it("讀寫方法本身丟錯時也安全降級", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;

    expect(safeStorageGet(blocked, "key")).toBeNull();
    expect(() => safeStorageSet(blocked, "key", "value")).not.toThrow();
    expect(() => safeStorageRemove(blocked, "key")).not.toThrow();
  });
});
