const ROVING_TAB_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

export function getRovingTabTargetIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
) {
  if (!ROVING_TAB_KEYS.has(key) || itemCount <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % itemCount;
  return (currentIndex - 1 + itemCount) % itemCount;
}
