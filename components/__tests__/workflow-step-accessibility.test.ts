// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { focusWorkflowStageHeading } from "@/components/workflow/workflow-step-accessibility";

afterEach(() => {
  document.body.replaceChildren();
});

describe("focusWorkflowStageHeading", () => {
  it("makes the current stage heading programmatically focusable and focuses it", () => {
    const container = document.createElement("div");
    container.innerHTML = "<header><h2>分流秤重</h2></header>";
    document.body.append(container);

    expect(focusWorkflowStageHeading(container)).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("h2"));
    expect(container.querySelector("h2")?.tabIndex).toBe(-1);
  });

  it("does nothing when a stage has no heading", () => {
    const container = document.createElement("div");
    document.body.append(container);

    expect(focusWorkflowStageHeading(container)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
