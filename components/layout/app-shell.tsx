"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  Camera,
  ChartNoAxesCombined,
  CircleGauge,
  ClipboardCheck,
  Ellipsis,
  FlaskConical,
  Leaf,
  ListChecks,
  MonitorPlay,
  ScanLine,
  ScanSearch,
  Settings2,
  Truck,
  X,
  AlertTriangle,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { useFoodLens } from "@/components/data-provider";
import { GameModeProvider } from "@/components/game/game-mode-context";
import { CaseClosedCelebration } from "@/components/game/case-closed-celebration";
import {
  GameModeToggle,
  SidebarModeToggle,
} from "@/components/game/game-toggle";
import tourStyles from "./tour-story.module.css";

const TAIPEI_LUNCH_SOURCE =
  "https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=55614625852816D3";

const navGroups = [
  {
    label: "食光偵探所",
    items: [
      { label: "食光總部", href: "/", icon: CircleGauge },
      { label: "拍照破案", href: "/scan", icon: Camera },
      { label: "偵探手冊", href: "/records", icon: ListChecks },
      { label: "評審簡報", href: "/presentation", icon: MonitorPlay },
    ],
  },
];

function getTourSteps(isDemo: boolean) {
  return [
    {
      title: "1｜看見問題",
      text: isDemo
        ? "115 學年度臺北市營養午餐約涵蓋 18.6 萬名學生；本原型先用 48 筆模擬餐期測試如何回答剩多少、剩什麼。"
        : "控制中心先回答：剩多少、最常剩什麼，以及前後比較是否出現差異。",
      href: "/",
      cta: "查看控制中心",
      sourceHref: TAIPEI_LUNCH_SOURCE,
      sourceLabel: "來源：臺北市政府（115/04）",
    },
    {
      title: "2｜把一餐的證據接起來",
      text: isDemo
        ? "從示範菜單照片初判、五類分流秤重、匿名原因，到人類決定是否小型試驗；每一步都保留來源。"
        : "從菜單照片初判、五類分流秤重、匿名原因，到人類決定是否小型試驗；每一步都保留來源。",
      href: "/workflow",
      cta: "進入午餐任務台",
      sourceHref: undefined,
      sourceLabel: undefined,
    },
    {
      title: "3｜辨識先整理，學生確認",
      text: isDemo
        ? "固定規則初判只示範流程，不代表真實 AI 效能；學生逐項修正後才會保存。"
        : "辨識服務協助整理食物與剩餘比例，並逐次標示 Mock／真實；學生逐項修正後才會保存。",
      href: "/scan",
      cta: "實際掃描餐盤",
      sourceHref: undefined,
      sourceLabel: undefined,
    },
    {
      title: "4｜從資料找規律",
      text: "規則引擎依樣本門檻產生洞察，再用有上限的公式試算；結論附期間、樣本數與依據。",
      href: "/lab",
      cta: "查看數據實驗室",
      sourceHref: undefined,
      sourceLabel: undefined,
    },
    {
      title: "5｜追到最終去向",
      text: "預定地點、清運交接、處理場申報與校方核驗分開保存；沒有核驗收據，就不宣稱實際去向。",
      href: "/trace",
      cta: "查看廚餘去向證據",
      sourceHref: undefined,
      sourceLabel: undefined,
    },
    {
      title: "6｜驗證改善，再評估擴大",
      text: isDemo
        ? "27% → 19% 是刻意設計的前後比較情境；先檢查樣本與限制，再用公開假設估算擴大影響，不當成成果。"
        : "先呈現原始率、下降百分點、樣本與限制；通過檢查後，才用公開假設評估全校擴大情境。",
      href: "/experiments",
      cta: isDemo ? "查看前後比較情境" : "查看改善證據",
      sourceHref: undefined,
      sourceLabel: undefined,
    },
  ];
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <ScanLine size={19} strokeWidth={2.4} />
    </div>
  );
}

export function TourDialog({
  returnFocusRef,
}: {
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { tourOpen, setTourOpen, mode } = useFoodLens();
  const [selectedStep, setSelectedStep] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const entryFocusFrameRef = useRef<number | undefined>(undefined);
  const returnFocusFrameRef = useRef<number | undefined>(undefined);
  const close = () => {
    if (dialogRef.current?.open) {
      dialogRef.current.close();
    } else {
      setTourOpen(false);
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (tourOpen && !dialog.open) {
      if (returnFocusFrameRef.current !== undefined)
        window.cancelAnimationFrame(returnFocusFrameRef.current);
      const activeElement = document.activeElement as HTMLElement | null;
      previousFocusRef.current =
        returnFocusRef.current?.isConnected === true
          ? returnFocusRef.current
          : activeElement && activeElement !== document.body
            ? activeElement
            : null;
      dialog.showModal();
      entryFocusFrameRef.current = window.requestAnimationFrame(() => {
        if (dialog.open) closeButtonRef.current?.focus();
      });
    } else if (!tourOpen && dialog.open) {
      dialog.close();
    }
  }, [returnFocusRef, tourOpen, setTourOpen]);

  useEffect(
    () => () => {
      if (entryFocusFrameRef.current !== undefined)
        window.cancelAnimationFrame(entryFocusFrameRef.current);
      if (returnFocusFrameRef.current !== undefined)
        window.cancelAnimationFrame(returnFocusFrameRef.current);
    },
    [],
  );

  const tourSteps = getTourSteps(mode === "demo-local");
  const activeStep = tourSteps[selectedStep] ?? tourSteps[0];
  return (
    <dialog
      ref={dialogRef}
      className="tour-modal"
      aria-labelledby="tour-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        if (entryFocusFrameRef.current !== undefined)
          window.cancelAnimationFrame(entryFocusFrameRef.current);
        setTourOpen(false);
        const previousFocus =
          previousFocusRef.current?.isConnected === true
            ? previousFocusRef.current
            : returnFocusRef.current;
        if (previousFocus?.isConnected) {
          const restoreFocus = () => {
            if (!dialogRef.current?.open && previousFocus.isConnected)
              previousFocus.focus({ preventScroll: true });
          };
          // Restore inside the close event, then after the native top layer settles.
          // A later reopen must not let this fallback steal focus from the dialog.
          restoreFocus();
          if (returnFocusFrameRef.current !== undefined)
            window.cancelAnimationFrame(returnFocusFrameRef.current);
          returnFocusFrameRef.current =
            window.requestAnimationFrame(restoreFocus);
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <section
        className="tour-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          className="icon-button tour-close"
          onClick={close}
          aria-label="關閉導覽"
        >
          <X size={19} />
        </button>
        <div className="tour-visual">
          <ScanSearch aria-hidden="true" />
          <span>30</span>
          <small>秒理解</small>
        </div>
        <div className="tour-content">
          <p className="section-kicker">預防浪費 × 去向責任 × 改善驗證</p>
          <h2 id="tour-title">30 秒看懂 FoodLens</h2>
          <ol className={tourStyles.map} aria-label="FoodLens 六步驟循環">
            {tourSteps.map((item, index) => (
              <li key={item.title}>
                <button
                  type="button"
                  aria-pressed={selectedStep === index}
                  aria-controls="tour-step-detail"
                  onClick={() => setSelectedStep(index)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.title.replace(/^\d+｜/, "")}</strong>
                </button>
              </li>
            ))}
          </ol>
          <section
            id="tour-step-detail"
            className={tourStyles.detail}
            aria-live="polite"
          >
            <header>
              <span>{activeStep.title}</span>
              {activeStep.sourceHref && (
                <a
                  href={activeStep.sourceHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  {activeStep.sourceLabel}
                </a>
              )}
            </header>
            <p>{activeStep.text}</p>
            <Link href={activeStep.href} onClick={close}>
              {activeStep.cta}
              <ArrowRight size={14} />
            </Link>
          </section>
          <div className={tourStyles.actions}>
            <Link className="ghost-button" href="/presentation" onClick={close}>
              <MonitorPlay size={16} />8 分鐘完整簡報
            </Link>
            <Link className="primary-button" href="/scan" onClick={close}>
              親手掃描一張餐盤
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </dialog>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const previousPathRef = useRef(pathname);
  const [moreOpenForPath, setMoreOpenForPath] = useState<string | null>(null);
  const tourButtonRef = useRef<HTMLButtonElement>(null);
  const tourReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const {
    snapshot,
    filters,
    setFilters,
    setTourOpen,
    mode,
    storageMode,
    cloudReconnectAvailable,
    error,
    refresh,
    setMode,
  } = useFoodLens();
  const moreItems = [
    { label: "8 分鐘簡報", href: "/presentation", icon: MonitorPlay },
    { label: "餐期日誌", href: "/records", icon: ListChecks },
    { label: "供餐試算", href: "/forecast", icon: ChartNoAxesCombined },
    { label: "改善實驗", href: "/experiments", icon: FlaskConical },
    { label: "去向追蹤", href: "/trace", icon: Truck },
    { label: "永續影響", href: "/impact", icon: Leaf },
    { label: "專題研究", href: "/research", icon: BookOpenText },
    { label: "教師管理", href: "/admin", icon: Settings2 },
  ];
  const moreOpen = moreOpenForPath === pathname;
  const moreActive = moreItems.some((item) => pathname.startsWith(item.href));
  const latestRecordDate = snapshot?.meals.reduce(
    (latest, meal) => (meal.servedOn > latest ? meal.servedOn : latest),
    "",
  );

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpenForPath(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpenForPath(null);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreOpen]);

  return (
    <GameModeProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">
          跳到主要內容
        </a>
        <aside className="sidebar">
          <Link className="brand" href="/" aria-label="FoodLens 食光偵探首頁">
            <BrandMark />
            <span>
              <strong>FoodLens</strong>
              <small>食光偵探</small>
            </span>
          </Link>
          <nav className="side-nav" aria-label="主要導覽">
            {navGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  return (
                    <Link
                      className={`nav-item${active ? " active" : ""}`}
                      href={item.href}
                      key={item.href}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                      {active && <span className="active-dot" />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <SidebarModeToggle />
          <div className="sidebar-foot">
            <Link
              className={
                pathname.startsWith("/admin")
                  ? "font-bold text-[var(--green-dark)]"
                  : ""
              }
              href="/admin"
            >
              <Settings2 size={18} />
              教師管理
            </Link>
            <p>科技助力社會創新</p>
            <span>臺北市 115 學年度</span>
          </div>
        </aside>
        <main className="main-content" id="main-content" tabIndex={-1}>
          <header className="topbar">
            <div className="mobile-brand">
              <BrandMark />
              <strong>FoodLens</strong>
            </div>
            <div className="status-cluster" aria-label="目前系統狀態">
              <span className="status-pill ai-ready">
                <span />
                ✨ Gemini AI 視覺模型就緒
              </span>
              <span className="status-pill demo">
                {mode === "demo-local"
                  ? `示範 ${snapshot?.meals.length ?? 48} 餐期`
                  : `校園記錄 ${snapshot?.meals.length ?? 0} 餐期`}
              </span>
              <GameModeToggle compact />
            </div>
            <div className="top-actions">
              <Link
                className="ghost-button presentation-button"
                href="/presentation"
              >
                <MonitorPlay size={16} />
                <span>8 分鐘簡報</span>
              </Link>
              <button
                ref={tourButtonRef}
                className="ghost-button tour-button"
                type="button"
                onClick={(event) => {
                  tourReturnFocusRef.current = event.currentTarget;
                  setTourOpen(true);
                }}
              >
                <BookOpenText size={16} />
                <span>30 秒研究摘要</span>
              </button>
              <Link className="primary-button" href="/scan">
                <Camera size={17} />
                新增餐盤記錄
              </Link>
            </div>
          </header>
          {error && snapshot && (
            <div className="data-error-banner" role="alert">
              <AlertTriangle size={18} />
              <div>
                <strong>
                  {cloudReconnectAvailable
                    ? "校園雲端暫時無法連線"
                    : storageMode === "memory"
                      ? "已切換為暫存示範"
                      : "新資料暫時無法同步"}
                </strong>
                <span>
                  {error}
                  {cloudReconnectAvailable
                    ? "；可重新整理重試或使用示範資料。"
                    : "；示範資料仍可完整操作。"}
                </span>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void refresh()}
              >
                <RefreshCw size={14} />
                重試連線
              </button>
            </div>
          )}
          {children}
        </main>
        <nav className="mobile-nav" aria-label="手機主要導覽">
          <Link
            className={pathname === "/" ? "active" : ""}
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
          >
            <CircleGauge />
            <span>首頁</span>
          </Link>
          <Link
            className={pathname.startsWith("/scan") ? "active" : ""}
            href="/scan"
            aria-current={pathname.startsWith("/scan") ? "page" : undefined}
          >
            <Camera />
            <span>拍照</span>
          </Link>
          <Link
            className={pathname.startsWith("/records") ? "active" : ""}
            href="/records"
            aria-current={pathname.startsWith("/records") ? "page" : undefined}
          >
            <ListChecks />
            <span>紀錄</span>
          </Link>
          <Link
            className={pathname.startsWith("/presentation") ? "active" : ""}
            href="/presentation"
            aria-current={pathname.startsWith("/presentation") ? "page" : undefined}
          >
            <MonitorPlay />
            <span>簡報</span>
          </Link>
        </nav>
        <TourDialog returnFocusRef={tourReturnFocusRef} />
        <CaseClosedCelebration />
      </div>
    </GameModeProvider>
  );
}
