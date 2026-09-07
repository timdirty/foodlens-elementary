// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TourDialog } from "@/components/layout/app-shell";

const provider = vi.hoisted(() => ({
  open: true,
  setTourOpen: vi.fn(),
}));
const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

vi.mock("@/components/data-provider", () => ({
  useFoodLens: () => ({
    mode: "demo-local",
    tourOpen: provider.open,
    setTourOpen: provider.setTourOpen,
  }),
}));

function opener() {
  const element = document.createElement("button");
  element.textContent = "啟動導覽";
  document.body.append(element);
  const ref = createRef<HTMLButtonElement>();
  ref.current = element;
  return { element, ref };
}

beforeEach(() => {
  vi.useFakeTimers();
  provider.open = true;
  provider.setTourOpen.mockReset();
  // jsdom does not implement the native dialog top layer; browser E2E covers it.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  for (const [key, original] of [
    ["showModal", originalShowModal],
    ["close", originalClose],
  ] as const) {
    if (original)
      Object.defineProperty(HTMLDialogElement.prototype, key, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TourDialog focus lifecycle", () => {
  it("returns to the explicit launcher even when another element was active before opening", () => {
    const launcher = opener();
    const unrelated = document.createElement("button");
    unrelated.textContent = "不是啟動來源";
    document.body.append(unrelated);
    unrelated.focus();
    render(<TourDialog returnFocusRef={launcher.ref} />);
    act(() => vi.advanceTimersByTime(20));
    expect(screen.getByRole("button", { name: "關閉導覽" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "關閉導覽" }));
    expect(launcher.element).toHaveFocus();
    act(() => vi.advanceTimersByTime(20));
    expect(launcher.element).toHaveFocus();
    expect(provider.setTourOpen).toHaveBeenCalledWith(false);
  });

  it("cancels pending entry focus when the modal closes before its first frame", () => {
    const launcher = opener();
    render(<TourDialog returnFocusRef={launcher.ref} />);
    fireEvent.click(screen.getByRole("button", { name: "關閉導覽" }));
    expect(launcher.element).toHaveFocus();

    act(() => vi.advanceTimersByTime(40));
    expect(launcher.element).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not let a previous close fallback steal focus when immediately reopened", () => {
    const launcher = opener();
    const view = render(<TourDialog returnFocusRef={launcher.ref} />);
    act(() => vi.advanceTimersByTime(20));
    fireEvent.click(screen.getByRole("button", { name: "關閉導覽" }));
    provider.open = false;
    view.rerender(<TourDialog returnFocusRef={launcher.ref} />);
    provider.open = true;
    view.rerender(<TourDialog returnFocusRef={launcher.ref} />);
    act(() => vi.advanceTimersByTime(40));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("button", { name: "關閉導覽" })).toHaveFocus();
  });

  it("does not move focus after unmounting a closed dialog", () => {
    const launcher = opener();
    const view = render(<TourDialog returnFocusRef={launcher.ref} />);
    fireEvent.click(screen.getByRole("button", { name: "關閉導覽" }));
    view.unmount();
    const nextControl = document.createElement("button");
    document.body.append(nextControl);
    nextControl.focus();

    act(() => vi.advanceTimersByTime(40));
    expect(nextControl).toHaveFocus();
  });
});
