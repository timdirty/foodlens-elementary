export type ScanStorageMode = "indexeddb" | "memory" | "cloud";

const storageCopy: Record<
  ScanStorageMode,
  { label: string; warning?: string }
> = {
  cloud: { label: "學校私有 Supabase 空間" },
  indexeddb: { label: "此瀏覽器 IndexedDB" },
  memory: {
    label: "暫存記憶體",
    warning: "重新整理或關閉頁面後會遺失。",
  },
};

export function ScanStorageLocation({
  storageMode,
}: {
  storageMode: ScanStorageMode;
}) {
  const copy = storageCopy[storageMode];
  return (
    <span className="receipt-storage-value">
      <strong>{copy.label}</strong>
      {copy.warning && (
        <small className="receipt-storage-warning" role="status">
          {copy.warning}
        </small>
      )}
    </span>
  );
}
