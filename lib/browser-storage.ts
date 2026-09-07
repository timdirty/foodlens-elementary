export function getBrowserStorage(kind: "local" | "session") {
  try {
    if (typeof window === "undefined") return undefined;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function safeStorageGet(
  storage: Storage | undefined,
  key: string,
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeStorageSet(
  storage: Storage | undefined,
  key: string,
  value: string,
) {
  try {
    storage?.setItem(key, value);
  } catch {
    // The app remains usable when a browser blocks Web Storage.
  }
}

export function safeStorageRemove(storage: Storage | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // The request id can safely remain in memory for this page session.
  }
}
