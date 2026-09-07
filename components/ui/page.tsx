import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <span className="page-icon">
          <Icon size={20} />
        </span>
        <div>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
          <div>{description}</div>
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("panel", className)}>
      {children}
    </section>
  );
}

export function PanelTitle({
  kicker,
  title,
  note,
  action,
  headingRef,
  headingTabIndex,
}: {
  kicker?: string;
  title: string;
  note?: string;
  action?: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
  headingTabIndex?: number;
}) {
  return (
    <div className="panel-title">
      <div>
        {kicker && <p>{kicker}</p>}
        <h2 ref={headingRef} tabIndex={headingTabIndex}>
          {title}
        </h2>
        {note && <span>{note}</span>}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({
  label = "正在準備示範資料…",
}: {
  label?: string;
}) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <span className="loader" />
      <strong>{label}</strong>
      <p>資料會保存在這台裝置，重新整理後仍然存在。</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className="state-card"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function ErrorState({
  title = "資料暫時無法讀取",
  description,
  actions,
}: {
  title?: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="state-card error-state" role="alert" aria-live="assertive">
      <strong>{title}</strong>
      <p>{description}</p>
      {actions && <div className="button-row">{actions}</div>}
    </div>
  );
}
