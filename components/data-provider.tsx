"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Toaster } from "sonner";
import { HardDrive, RefreshCw } from "lucide-react";
import { scopeSnapshot } from "@/lib/analysis";
import { todayInTaipei } from "@/lib/date";
import { ErrorState } from "@/components/ui/page";
import {
  getBrowserStorage,
  safeStorageGet,
  safeStorageSet,
} from "@/lib/browser-storage";
import { DemoLocalRepository } from "@/lib/repositories/demo-local";
import { MemoryFoodLensRepository } from "@/lib/repositories/memory";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type {
  AppFilters,
  AppSnapshot,
  DataMode,
  FoodLensRepository,
} from "@/lib/types";

interface DataContextValue {
  snapshot?: AppSnapshot;
  scopedSnapshot?: AppSnapshot;
  loading: boolean;
  error?: string;
  mode: DataMode;
  storageMode: "indexeddb" | "memory" | "cloud";
  /** A cloud workspace was requested but the app is temporarily showing demo data. */
  cloudReconnectAvailable: boolean;
  setMode: (mode: DataMode) => Promise<void>;
  repository: FoodLensRepository;
  filters: AppFilters;
  setFilters: React.Dispatch<React.SetStateAction<AppFilters>>;
  refresh: () => Promise<void>;
  tourOpen: boolean;
  setTourOpen: (value: boolean) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

async function createCloudRepository(): Promise<FoodLensRepository> {
  const { SupabaseRepository } = await import("@/lib/repositories/supabase");
  return new SupabaseRepository();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("校園雲端連線逾時")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function requestPersistentStorage() {
  try {
    const request = globalThis.navigator?.storage?.persist?.();
    if (request) void request.catch(() => false);
  } catch {
    // Managed browsers can block this API; IndexedDB remains usable.
  }
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const demoRepository = useMemo(() => new DemoLocalRepository(), []);
  const memoryRepository = useMemo(() => new MemoryFoodLensRepository(), []);
  const [repository, setRepository] =
    useState<FoodLensRepository>(demoRepository);
  const [mode, setModeState] = useState<DataMode>("demo-local");
  const [storageMode, setStorageMode] = useState<
    "indexeddb" | "memory" | "cloud"
  >("indexeddb");
  const [cloudReconnectAvailable, setCloudReconnectAvailable] = useState(false);
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [filters, setFilters] = useState<AppFilters>({
    classId: "all",
    range: "8-weeks",
  });
  const [tourOpen, setTourOpen] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setError(undefined);
      setSnapshot(await repository.getSnapshot());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "無法讀取本機示範資料",
      );
    } finally {
      setLoading(false);
    }
  }, [repository]);
  const setMode = useCallback(
    async (nextMode: DataMode) => {
      setLoading(true);
      try {
        if (nextMode === "school-cloud") {
          if (!isSupabaseConfigured())
            throw new Error("尚未設定 Supabase 環境變數");
          // Preserve the user's intended workspace while auth or connectivity is
          // being recovered. A transient failure must not silently make Demo the
          // permanent preference on the next reload.
          safeStorageSet(
            getBrowserStorage("local"),
            "foodlens-data-mode",
            "school-cloud",
          );
          const cloudRepository = await createCloudRepository();
          setSnapshot(await withTimeout(cloudRepository.getSnapshot(), 8_000));
          setRepository(cloudRepository);
          setStorageMode("cloud");
          setCloudReconnectAvailable(false);
        } else {
          try {
            setSnapshot(await demoRepository.getSnapshot());
            setRepository(demoRepository);
            setStorageMode("indexeddb");
            setCloudReconnectAvailable(false);
            requestPersistentStorage();
          } catch {
            setSnapshot(await memoryRepository.getSnapshot());
            setRepository(memoryRepository);
            setStorageMode("memory");
            setCloudReconnectAvailable(false);
            setModeState("demo-local");
            safeStorageSet(
              getBrowserStorage("local"),
              "foodlens-data-mode",
              "demo-local",
            );
            setError(
              "這個瀏覽器封鎖 IndexedDB；已啟動可完整操作的暫存示範，重新整理後會重建資料。",
            );
            return;
          }
        }
        setModeState(nextMode);
        safeStorageSet(
          getBrowserStorage("local"),
          "foodlens-data-mode",
          nextMode,
        );
        setError(undefined);
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "無法切換資料模式";
        setError(message);
        if (nextMode === "school-cloud" && isSupabaseConfigured())
          setCloudReconnectAvailable(true);
        throw caught;
      } finally {
        setLoading(false);
      }
    },
    [demoRepository, memoryRepository],
  );
  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      const preferred = safeStorageGet(
        getBrowserStorage("local"),
        "foodlens-data-mode",
      );
      if (preferred === "school-cloud") {
        if (isSupabaseConfigured()) {
          try {
            const cloudRepository = await createCloudRepository();
            const value = await withTimeout(
              cloudRepository.getSnapshot(),
              6_000,
            );
            if (!active) return;
            setRepository(cloudRepository);
            setModeState("school-cloud");
            setStorageMode("cloud");
            setCloudReconnectAvailable(false);
            setSnapshot(value);
            setError(undefined);
            return;
          } catch (caught) {
            try {
              const value = await demoRepository.getSnapshot();
              if (!active) return;
              setRepository(demoRepository);
              setModeState("demo-local");
              setStorageMode("indexeddb");
              setCloudReconnectAvailable(true);
              setSnapshot(value);
              requestPersistentStorage();
              setError(
                `校園雲端沒有完成登入：${
                  caught instanceof Error ? caught.message : "無法連線"
                }。已安全回到此裝置示範模式。`,
              );
              return;
            } catch (fallbackError) {
              if (!active) return;
              const value = await memoryRepository.getSnapshot();
              if (!active) return;
              setRepository(memoryRepository);
              setModeState("demo-local");
              setStorageMode("memory");
              setCloudReconnectAvailable(true);
              setSnapshot(value);
              setError(
                "校園雲端與 IndexedDB 都無法使用；已啟動暫存示範，重新整理後會重建資料。" +
                  (fallbackError instanceof Error
                    ? `（${fallbackError.message}）`
                    : ""),
              );
              return;
            }
          }
        }
        safeStorageSet(
          getBrowserStorage("local"),
          "foodlens-data-mode",
          "demo-local",
        );
      }
      try {
        const value = await demoRepository.getSnapshot();
        if (!active) return;
        setRepository(demoRepository);
        setModeState("demo-local");
        setStorageMode("indexeddb");
        setCloudReconnectAvailable(false);
        setSnapshot(value);
        requestPersistentStorage();
        setError(
          preferred === "school-cloud" && !isSupabaseConfigured()
            ? "原本選擇校園雲端，但這次啟動沒有 Supabase 設定；已回到此裝置示範模式"
            : undefined,
        );
      } catch (caught) {
        const value = await memoryRepository.getSnapshot();
        if (!active) return;
        setRepository(memoryRepository);
        setModeState("demo-local");
        setStorageMode("memory");
        setCloudReconnectAvailable(false);
        setSnapshot(value);
        setError(
          "這個瀏覽器封鎖 IndexedDB；已啟動可完整操作的暫存示範，重新整理後會重建資料。" +
            (caught instanceof Error ? `（${caught.message}）` : ""),
        );
      }
    };
    void bootstrap().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [demoRepository, memoryRepository]);
  const scopedSnapshot = useMemo(
    () =>
      snapshot
        ? scopeSnapshot(
            snapshot,
            filters,
            mode === "school-cloud" ? todayInTaipei() : undefined,
          )
        : undefined,
    [snapshot, filters, mode],
  );
  const recoverDemo = useCallback(async () => {
    setLoading(true);
    try {
      const value = await demoRepository.getSnapshot();
      setRepository(demoRepository);
      setModeState("demo-local");
      setStorageMode("indexeddb");
      setCloudReconnectAvailable(false);
      setSnapshot(value);
      requestPersistentStorage();
      setError(undefined);
      safeStorageSet(
        getBrowserStorage("local"),
        "foodlens-data-mode",
        "demo-local",
      );
    } catch (caught) {
      setRepository(memoryRepository);
      setModeState("demo-local");
      setStorageMode("memory");
      setCloudReconnectAvailable(false);
      setSnapshot(await memoryRepository.getSnapshot());
      setError(
        "IndexedDB 仍無法使用，已改用暫存示範；重新整理後會重建資料。" +
          (caught instanceof Error ? `（${caught.message}）` : ""),
      );
    } finally {
      setLoading(false);
    }
  }, [demoRepository, memoryRepository]);
  useEffect(() => {
    if (mode !== "demo-local" || storageMode !== "indexeddb") return;
    let timer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 40);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    window.addEventListener("foodlens-demo-updated", scheduleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);
    let channel: BroadcastChannel | undefined;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel("foodlens-demo-updates");
      } catch {
        channel = undefined;
      }
    }
    if (channel) channel.onmessage = scheduleRefresh;
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("foodlens-demo-updated", scheduleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
      try {
        channel?.close();
      } catch {
        // Cross-tab notifications are best-effort; data is already persisted.
      }
    };
  }, [mode, refresh, storageMode]);
  if (!loading && error && !snapshot) {
    return (
      <div className="boot-error-wrap">
        <ErrorState
          description={`${error}。你的現有資料沒有被清除；可先重試，或回到只存在這台裝置的示範模式。`}
          actions={
            <>
              <button
                className="secondary-action"
                onClick={() => void refresh()}
              >
                <RefreshCw size={17} />
                重新讀取
              </button>
              <button
                className="primary-action"
                onClick={() => void recoverDemo()}
              >
                <HardDrive size={17} />
                啟動此裝置示範模式
              </button>
            </>
          }
        />
        <Toaster richColors position="top-center" />
      </div>
    );
  }
  return (
    <DataContext.Provider
      value={{
        snapshot,
        scopedSnapshot,
        loading,
        error,
        mode,
        storageMode,
        cloudReconnectAvailable,
        setMode,
        repository,
        filters,
        setFilters,
        refresh,
        tourOpen,
        setTourOpen,
      }}
    >
      {children}
      <Toaster richColors position="top-center" />
    </DataContext.Provider>
  );
}

export function useFoodLens() {
  const value = useContext(DataContext);
  if (!value) throw new Error("useFoodLens 必須在 DataProvider 內使用");
  return value;
}
