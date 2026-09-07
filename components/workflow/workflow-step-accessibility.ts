export function focusWorkflowStageHeading(container: HTMLElement | null) {
  const heading = container?.querySelector<HTMLHeadingElement>("h2");
  if (!heading) return false;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus();
  return document.activeElement === heading;
}
