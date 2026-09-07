"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  FileCheck2,
  FileUp,
  Fingerprint,
  Info,
  Truck,
} from "lucide-react";
import { createUuid, sha256Hex } from "@/lib/crypto";
import { useConfirmationFocus } from "@/components/trace/use-confirmation-focus";
import {
  TREATMENT_METHODS,
  TREATMENT_METHOD_LABELS,
  TRACE_WASTE_SOURCE_LABELS,
  collectionEventSchema,
  destinationReceiptSchema,
  type CollectionEvent,
  type DestinationReceipt,
  type TreatmentMethod,
} from "@/lib/circularity";
import type { DataMode } from "@/lib/types";
import styles from "@/app/(dashboard)/trace/trace.module.css";

function nextTimestamp(...values: Array<string | undefined>) {
  const floor = Math.max(
    Date.now(),
    ...values
      .filter(Boolean)
      .map((value) => Date.parse(value as string) + 1_000),
  );
  return new Date(floor).toISOString();
}

function taipeiInput(value: string, addMinutes = 0) {
  const instant = new Date(Date.parse(value) + addMinutes * 60_000);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function inputToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("請填寫完整日期與時間");
  const date = new Date(`${value}:00+08:00`);
  if (Number.isNaN(date.getTime())) throw new Error("日期與時間格式無效");
  return date.toISOString();
}

function positiveGram(value: string, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0)
    throw new Error(`${label}必須是大於 0 的整數克數`);
  return number;
}

function nonnegativeGram(value: string, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0)
    throw new Error(`${label}必須是 0 以上的整數克數`);
  return number;
}

function messageFrom(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    const issue = (error as { issues?: Array<{ message?: string }> })
      .issues?.[0];
    if (issue?.message) return issue.message;
  }
  return error instanceof Error ? error.message : "資料格式不完整，請逐項檢查";
}

const RECEIPT_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_RECEIPT_FILE_BYTES = 5 * 1024 * 1024;

function useReceiptDocument(initialHash?: string) {
  const [documentSha256, setDocumentSha256] = useState(initialHash);
  const [fileName, setFileName] = useState(
    initialHash ? "先前已登錄的外部文件" : "",
  );
  const [hashing, setHashing] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    setHashing(true);
    setFileError(undefined);
    try {
      if (!RECEIPT_FILE_TYPES.has(file.type))
        throw new Error("收據只接受 JPEG、PNG、WebP 或 PDF");
      if (file.size > MAX_RECEIPT_FILE_BYTES)
        throw new Error("收據檔案不可超過 5MB");
      setDocumentSha256(await sha256Hex(await file.arrayBuffer()));
      setFileName(file.name);
    } catch (caught) {
      setDocumentSha256(undefined);
      setFileName("");
      setFileError(messageFrom(caught));
    } finally {
      setHashing(false);
    }
  };
  return {
    documentSha256,
    fileName,
    hashing,
    fileError,
    selectFile,
  };
}

function ReceiptFileField({
  document,
}: {
  document: ReturnType<typeof useReceiptDocument>;
}) {
  return (
    <div className={styles.documentField}>
      <label>
        <FileUp size={18} aria-hidden="true" />
        <span>
          <strong>選取處理場收據原檔</strong>
          <small>JPEG、PNG、WebP 或 PDF，5MB 以下</small>
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(event) =>
            void document.selectFile(event.target.files?.[0])
          }
        />
      </label>
      {document.hashing ? (
        <p role="status">正在計算文件指紋…</p>
      ) : document.documentSha256 ? (
        <p className={styles.fingerprint}>
          <Fingerprint size={15} aria-hidden="true" />
          <span>
            {document.fileName}・SHA-256 {document.documentSha256.slice(0, 16)}…
          </span>
        </p>
      ) : (
        <p>尚未選檔；正式資料可先申報，但核驗前必須補齊。</p>
      )}
      {document.fileError && (
        <p className={styles.documentError} role="alert">
          {document.fileError}
        </p>
      )}
      <small className={styles.externalFileNote}>
        首版只保存 SHA-256
        文件指紋，不上傳或保存原檔；原收據請留在校方核准的文件系統。
      </small>
    </div>
  );
}

function ConfirmationPanel({
  focusTarget,
  title,
  statements,
  checked,
  onChecked,
  onCancel,
  onConfirm,
  busy,
  mode,
  attestationText = "我已對照現場交接或處理場收據；空值、預定值與實際值沒有混用。",
}: {
  focusTarget: Ref<HTMLElement>;
  title: string;
  statements: string[];
  checked: boolean;
  onChecked: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  mode: DataMode;
  attestationText?: string;
}) {
  return (
    <section
      ref={focusTarget}
      className={styles.confirmation}
      aria-label="送出前二次確認"
      tabIndex={-1}
    >
      <div className={styles.confirmationHeading}>
        <ClipboardCheck size={20} aria-hidden="true" />
        <div>
          <strong>{title}</strong>
          <span>
            {mode === "demo-local"
              ? "這次操作只改變本機示範資料。"
              : "送出後會寫入本校正式稽核資料。"}
          </span>
        </div>
      </div>
      <ul>
        {statements.map((statement) => (
          <li key={statement}>{statement}</li>
        ))}
      </ul>
      <label className={styles.attestation}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChecked(event.target.checked)}
        />
        <span>{attestationText}</span>
      </label>
      <div className={styles.actionRow}>
        <button type="button" className="ghost-button" onClick={onCancel}>
          返回修改
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!checked || busy}
          onClick={onConfirm}
        >
          <Check size={16} aria-hidden="true" />
          {busy ? "正在保存…" : "確認寫入"}
        </button>
      </div>
    </section>
  );
}

function FieldError({ error, id }: { error?: string; id: string }) {
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return error ? (
    <p
      ref={errorRef}
      id={id}
      className={styles.formError}
      role="alert"
      tabIndex={-1}
    >
      {error}
    </p>
  ) : null;
}

function CollectionAction({
  event,
  suggestedWeightG,
  mode,
  busy,
  onSave,
}: {
  event: CollectionEvent;
  suggestedWeightG: number;
  mode: DataMode;
  busy: boolean;
  onSave: (event: CollectionEvent) => Promise<void>;
}) {
  const [haulerName, setHaulerName] = useState(
    mode === "demo-local" ? "示範清運合作單位" : "",
  );
  const [manifestReference, setManifestReference] = useState(
    mode === "demo-local" ? `DEMO-LIVE-${event.evidenceCaseId}` : "",
  );
  const [weight, setWeight] = useState(
    mode === "demo-local" && suggestedWeightG > 0
      ? String(suggestedWeightG)
      : "",
  );
  const [collectedAt, setCollectedAt] = useState(
    taipeiInput(event.scheduledAt, 15),
  );
  const [candidate, setCandidate] = useState<CollectionEvent>();
  const [cancellation, setCancellation] = useState<CollectionEvent>();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string>();
  const {
    setReviewElement: setCollectionReviewElement,
    setReturnFocusElement: setCollectionReturnElement,
    returnToEditor: returnToCollectionEditor,
  } = useConfirmationFocus(Boolean(candidate));
  const {
    setReviewElement: setCancellationReviewElement,
    setReturnFocusElement: setCancellationReturnElement,
    returnToEditor: returnToCancellationEditor,
  } = useConfirmationFocus(Boolean(cancellation));

  const review = () => {
    try {
      const collectedIso = inputToIso(collectedAt);
      const updatedAt = nextTimestamp(event.updatedAt, collectedIso);
      const value = collectionEventSchema.parse({
        ...event,
        status: "collected",
        collectedAt: collectedIso,
        haulerName,
        manifestReference: manifestReference.trim() || undefined,
        netCollectedWeightG: nonnegativeGram(weight, "校方交接淨重"),
        updatedAt,
      });
      setCandidate(value);
      setChecked(false);
      setError(undefined);
    } catch (caught) {
      setError(messageFrom(caught));
    }
  };

  const reviewCancellation = () => {
    try {
      setCancellation(
        collectionEventSchema.parse({
          ...event,
          status: "cancelled",
          updatedAt: nextTimestamp(event.updatedAt),
        }),
      );
      setChecked(false);
      setError(undefined);
    } catch (caught) {
      setError(messageFrom(caught));
    }
  };

  if (cancellation)
    return (
      <ConfirmationPanel
        focusTarget={setCancellationReviewElement}
        title="確認取消這筆尚未交接的安排"
        statements={[
          `預定去向：${cancellation.plannedDestinationName}`,
          `本批來源：${cancellation.wasteSources
            .map((source) => TRACE_WASTE_SOURCE_LABELS[source])
            .join("＋")}`,
          "取消後保留稽核紀錄，這些來源可重新安排到另一批。",
          "若已經發生實際交接，請返回並完成交接證據，不可用取消掩蓋。",
        ]}
        checked={checked}
        onChecked={setChecked}
        onCancel={() =>
          returnToCancellationEditor(() => setCancellation(undefined))
        }
        onConfirm={() => onSave(cancellation)}
        busy={busy}
        mode={mode}
        attestationText="我確認這筆安排尚未發生實際交接，取消不是用來刪除或改寫已發生的證據。"
      />
    );

  if (candidate)
    return (
      <ConfirmationPanel
        focusTarget={setCollectionReviewElement}
        title="確認校方已把本批廚餘交給清運單位"
        statements={[
          `清運單位：${candidate.haulerName}`,
          `交接編號：${candidate.manifestReference ?? "尚待清運聯單補登"}`,
          `本批來源：${candidate.wasteSources
            .map((source) => TRACE_WASTE_SOURCE_LABELS[source])
            .join("＋")}`,
          `交接淨重：${(candidate.netCollectedWeightG! / 1000).toFixed(2)} kg（${candidate.weightState === "standard_drained" ? "標準瀝水後" : "依畫面標示重量狀態"}）`,
          `預定去向仍只是計畫：${candidate.plannedDestinationName}`,
        ]}
        checked={checked}
        onChecked={setChecked}
        onCancel={() => returnToCollectionEditor(() => setCandidate(undefined))}
        onConfirm={() => onSave(candidate)}
        busy={busy}
        mode={mode}
      />
    );

  return (
    <form
      className={styles.actionForm}
      aria-describedby={error ? "trace-collection-error" : undefined}
      onSubmit={(event_) => {
        event_.preventDefault();
        review();
      }}
    >
      <div className={styles.actionIntro}>
        <Truck size={22} aria-hidden="true" />
        <div>
          <p>第 2 關｜校方 × 清運單位</p>
          <h2>完成交接證據</h2>
          <span>預定目的地不會因為完成交接，就自動變成實際去向。</span>
        </div>
      </div>
      <div className={styles.formGrid}>
        <label>
          清運單位
          <input
            value={haulerName}
            onChange={(event_) => setHaulerName(event_.target.value)}
            placeholder="例如：○○清運公司"
            required
          />
        </label>
        <label>
          清運聯單／交接編號（可稍後補）
          <input
            value={manifestReference}
            onChange={(event_) => setManifestReference(event_.target.value)}
            placeholder="未收到聯單可先留空"
          />
        </label>
        <label>
          校方交接淨重（g）
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={weight}
            onChange={(event_) => setWeight(event_.target.value)}
            placeholder="請實際秤重"
            required
          />
        </label>
        <label>
          實際交接時間
          <input
            type="datetime-local"
            value={collectedAt}
            onChange={(event_) => setCollectedAt(event_.target.value)}
            required
          />
        </label>
      </div>
      <FieldError error={error} id="trace-collection-error" />
      <div className={styles.formActions}>
        <button
          ref={setCancellationReturnElement}
          type="button"
          className={`ghost-button ${styles.dangerButton}`}
          disabled={busy}
          onClick={reviewCancellation}
        >
          取消這筆安排
        </button>
        <button
          ref={setCollectionReturnElement}
          type="submit"
          className="primary-button"
          disabled={busy}
        >
          檢查交接資料 <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function ReceiptSubmissionAction({
  event,
  afterTimestamp,
  mode,
  busy,
  onSave,
}: {
  event: CollectionEvent;
  afterTimestamp?: string;
  mode: DataMode;
  busy: boolean;
  onSave: (receipt: DestinationReceipt) => Promise<void>;
}) {
  const [facilityName, setFacilityName] = useState(
    mode === "demo-local" ? event.plannedDestinationName : "",
  );
  const [reference, setReference] = useState(
    mode === "demo-local"
      ? `DEMO-RC-${event.evidenceCaseId}${afterTimestamp ? `-R${Date.parse(afterTimestamp)}` : ""}`
      : "",
  );
  const [method, setMethod] = useState<TreatmentMethod>(
    mode === "demo-local" ? event.plannedTreatmentMethod : "unknown",
  );
  const [acceptedWeight, setAcceptedWeight] = useState(
    mode === "demo-local" && event.netCollectedWeightG
      ? String(Math.max(1, event.netCollectedWeightG - 120))
      : "",
  );
  const [receivedAt, setReceivedAt] = useState(
    taipeiInput(event.collectedAt ?? event.scheduledAt, 45),
  );
  const [candidate, setCandidate] = useState<DestinationReceipt>();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string>();
  const document = useReceiptDocument();
  const { setReviewElement, setReturnFocusElement, returnToEditor } =
    useConfirmationFocus(Boolean(candidate));

  const review = () => {
    try {
      const receivedIso = inputToIso(receivedAt);
      const createdAt = nextTimestamp(
        event.updatedAt,
        receivedIso,
        afterTimestamp,
      );
      const value = destinationReceiptSchema.parse({
        id: createUuid(),
        collectionEventId: event.id,
        receiptReference: reference,
        facilityName,
        actualTreatmentMethod: method,
        acceptedWeightG: acceptedWeight
          ? positiveGram(acceptedWeight, "處理場收料重量")
          : undefined,
        receivedAt: receivedIso,
        status: "submitted",
        documentSha256: document.documentSha256,
        provenance: mode === "demo-local" ? "demo" : "official",
        createdAt,
        updatedAt: createdAt,
      });
      setCandidate(value);
      setChecked(false);
      setError(undefined);
    } catch (caught) {
      setError(messageFrom(caught));
    }
  };

  if (candidate)
    return (
      <ConfirmationPanel
        focusTarget={setReviewElement}
        title="確認登錄一張處理場申報收據"
        statements={[
          `收據編號：${candidate.receiptReference}`,
          `申報處理場：${candidate.facilityName}`,
          `申報方式：${TREATMENT_METHOD_LABELS[candidate.actualTreatmentMethod]}`,
          candidate.documentSha256
            ? `文件指紋：${candidate.documentSha256.slice(0, 16)}…`
            : "尚未附原文件；只能維持待核驗",
          "這一步只代表收到申報；核驗前不顯示為實際去向。",
        ]}
        checked={checked}
        onChecked={setChecked}
        onCancel={() => returnToEditor(() => setCandidate(undefined))}
        onConfirm={() => onSave(candidate)}
        busy={busy}
        mode={mode}
      />
    );

  return (
    <form
      className={styles.actionForm}
      aria-describedby={error ? "trace-receipt-error" : undefined}
      onSubmit={(event_) => {
        event_.preventDefault();
        review();
      }}
    >
      <div className={styles.actionIntro}>
        <Building2 size={22} aria-hidden="true" />
        <div>
          <p>第 3 關｜處理場提供、校方登錄</p>
          <h2>登錄處理場收據</h2>
          <span>收據內容先標為「申報」，下一關核對後才成為已核驗結果。</span>
        </div>
      </div>
      <div className={styles.formGrid}>
        <label>
          收據／入場單編號
          <input
            value={reference}
            onChange={(event_) => setReference(event_.target.value)}
            placeholder="依處理場文件填寫"
            required
          />
        </label>
        <label>
          處理場名稱
          <input
            value={facilityName}
            onChange={(event_) => setFacilityName(event_.target.value)}
            placeholder="不得只複製預定地點"
            required
          />
        </label>
        <label>
          收據申報處理方式
          <select
            value={method}
            onChange={(event_) =>
              setMethod(event_.target.value as TreatmentMethod)
            }
          >
            {TREATMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {TREATMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          收據申報收料重量（g，可稍後補）
          <input
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={acceptedWeight}
            onChange={(event_) => setAcceptedWeight(event_.target.value)}
            placeholder="核驗前可暫留空"
          />
        </label>
        <label>
          處理場收料時間
          <input
            type="datetime-local"
            value={receivedAt}
            onChange={(event_) => setReceivedAt(event_.target.value)}
            required
          />
        </label>
      </div>
      <ReceiptFileField document={document} />
      <FieldError error={error} id="trace-receipt-error" />
      <button
        ref={setReturnFocusElement}
        type="submit"
        className="primary-button"
        disabled={busy || document.hashing}
      >
        檢查申報資料 <ArrowRight size={16} aria-hidden="true" />
      </button>
    </form>
  );
}

function ReceiptVerificationAction({
  receipt,
  mode,
  busy,
  onSave,
}: {
  receipt: DestinationReceipt;
  mode: DataMode;
  busy: boolean;
  onSave: (receipt: DestinationReceipt) => Promise<void>;
}) {
  const [method, setMethod] = useState<TreatmentMethod>(
    receipt.actualTreatmentMethod,
  );
  const [acceptedWeight, setAcceptedWeight] = useState(
    receipt.acceptedWeightG ? String(receipt.acceptedWeightG) : "",
  );
  const [rejectionReason, setRejectionReason] = useState("");
  const [candidate, setCandidate] = useState<DestinationReceipt>();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string>();
  const document = useReceiptDocument(receipt.documentSha256);
  const {
    setReviewElement: setVerificationReviewElement,
    setReturnFocusElement: setVerificationReturnElement,
    returnToEditor: returnToVerificationEditor,
  } = useConfirmationFocus(candidate?.status === "verified");
  const {
    setReviewElement: setRejectionReviewElement,
    setReturnFocusElement: setRejectionReturnElement,
    returnToEditor: returnToRejectionEditor,
  } = useConfirmationFocus(candidate?.status === "rejected");

  const review = () => {
    try {
      if (method === "unknown") throw new Error("請依收據確認實際處理方式");
      if (mode === "school-cloud" && !document.documentSha256)
        throw new Error("正式收據核驗前必須選取原文件並保存 SHA-256 指紋");
      const verifiedAt = nextTimestamp(receipt.receivedAt, receipt.updatedAt);
      const value = destinationReceiptSchema.parse({
        ...receipt,
        actualTreatmentMethod: method,
        acceptedWeightG: positiveGram(acceptedWeight, "處理場收料重量"),
        status: "verified",
        verifiedBy:
          mode === "demo-local" ? "示範校方覆核人員" : "current-school-user",
        verifiedAt,
        documentSha256: document.documentSha256,
        updatedAt: verifiedAt,
      });
      setCandidate(value);
      setChecked(false);
      setError(undefined);
    } catch (caught) {
      setError(messageFrom(caught));
    }
  };

  const reviewRejection = () => {
    try {
      const updatedAt = nextTimestamp(receipt.updatedAt);
      setCandidate(
        destinationReceiptSchema.parse({
          ...receipt,
          status: "rejected",
          rejectionReason,
          verifiedBy: undefined,
          verifiedAt: undefined,
          updatedAt,
        }),
      );
      setChecked(false);
      setError(undefined);
    } catch (caught) {
      setError(messageFrom(caught));
    }
  };

  if (candidate)
    return (
      <ConfirmationPanel
        focusTarget={
          candidate.status === "rejected"
            ? setRejectionReviewElement
            : setVerificationReviewElement
        }
        title={
          candidate.status === "rejected"
            ? "確認退回這張不合格收據"
            : "最後確認：收據內容已逐項核對"
        }
        statements={
          candidate.status === "rejected"
            ? [
                `收據編號：${candidate.receiptReference}`,
                `退回原因：${candidate.rejectionReason}`,
                "退回後保留這張收據的稽核紀錄，必須另建新收據才能再次申報。",
              ]
            : [
                `收據編號：${candidate.receiptReference}`,
                `實際處理場：${candidate.facilityName}`,
                `實際處理方式：${TREATMENT_METHOD_LABELS[candidate.actualTreatmentMethod]}`,
                `處理場收料重量：${(candidate.acceptedWeightG! / 1000).toFixed(2)} kg`,
                candidate.documentSha256
                  ? `文件指紋：${candidate.documentSha256.slice(0, 16)}…`
                  : "示範操作未附文件；不代表正式核驗規格",
              ]
        }
        checked={checked}
        onChecked={setChecked}
        onCancel={() =>
          (candidate.status === "rejected"
            ? returnToRejectionEditor
            : returnToVerificationEditor)(() => setCandidate(undefined))
        }
        onConfirm={() => onSave(candidate)}
        busy={busy}
        mode={mode}
        attestationText={
          candidate.status === "rejected"
            ? "我確認收據確實不合格，退回原因足以讓處理場或校方重新補正。"
            : undefined
        }
      />
    );

  return (
    <form
      className={styles.actionForm}
      aria-describedby={error ? "trace-verification-error" : undefined}
      onSubmit={(event_) => {
        event_.preventDefault();
        review();
      }}
    >
      <div className={styles.actionIntro}>
        <FileCheck2 size={22} aria-hidden="true" />
        <div>
          <p>第 4 關｜校方授權人員</p>
          <h2>核驗收據，不替處理場補答案</h2>
          <span>請以收據為依據；資料不完整就維持待核驗，不做推測。</span>
        </div>
      </div>
      <div className={styles.receiptReference}>
        <span>處理場申報</span>
        <strong>{receipt.facilityName}</strong>
        <small>收據 {receipt.receiptReference}</small>
      </div>
      <div className={styles.formGrid}>
        <label>
          收據上的實際處理方式
          <select
            value={method}
            onChange={(event_) =>
              setMethod(event_.target.value as TreatmentMethod)
            }
            required
          >
            {TREATMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {TREATMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          收據上的處理場收料重量（g）
          <input
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={acceptedWeight}
            onChange={(event_) => setAcceptedWeight(event_.target.value)}
            placeholder="必須逐字對照收據"
            required
          />
        </label>
      </div>
      <ReceiptFileField document={document} />
      <p className={styles.truthNote}>
        <Info size={16} aria-hidden="true" />
        核驗只證明文件與登錄內容一致；不等於 FoodLens 自行查證處理場技術成效。
      </p>
      <FieldError error={error} id="trace-verification-error" />
      <button
        ref={setVerificationReturnElement}
        type="submit"
        className="primary-button"
        disabled={busy || document.hashing}
      >
        檢查核驗內容 <ArrowRight size={16} aria-hidden="true" />
      </button>
      <div className={styles.rejectionBox}>
        <label>
          <strong>收據不完整或內容不符？</strong>
          <span>請留下可補正的具體原因，不要直接改寫處理場申報。</span>
          <textarea
            value={rejectionReason}
            onChange={(event_) => setRejectionReason(event_.target.value)}
            placeholder="例如：收料重量與原始入場單不符，請重新提供文件"
            maxLength={300}
          />
        </label>
        <button
          ref={setRejectionReturnElement}
          type="button"
          className={`ghost-button ${styles.dangerButton}`}
          disabled={busy || !rejectionReason.trim()}
          onClick={reviewRejection}
        >
          檢查退回原因
        </button>
      </div>
    </form>
  );
}

export function TraceActionPanel({
  event,
  receipt,
  suggestedWeightG,
  mode,
  busy,
  onSaveCollection,
  onSaveReceipt,
}: {
  event: CollectionEvent;
  receipt?: DestinationReceipt;
  suggestedWeightG: number;
  mode: DataMode;
  busy: boolean;
  onSaveCollection: (event: CollectionEvent) => Promise<void>;
  onSaveReceipt: (receipt: DestinationReceipt) => Promise<void>;
}) {
  if (event.status === "cancelled")
    return (
      <div className={styles.completedAction}>
        <Info size={24} aria-hidden="true" />
        <h2>這筆清運已取消</h2>
        <p>保留取消狀態作為稽核紀錄；如需重新安排，請建立新的清運事件。</p>
      </div>
    );
  if (receipt?.status === "verified")
    return (
      <div className={styles.completedAction}>
        <Check size={24} aria-hidden="true" />
        <h2>這批資料已完成四段證據</h2>
        <p>
          實際去向只引用已核驗收據。FoodLens
          不據此推算減碳，也不把處理方式美化成循環成果。
        </p>
      </div>
    );
  if (receipt?.status === "rejected")
    return (
      <div className={styles.rejectedFlow}>
        <aside className={styles.rejectedNotice} role="status">
          <Info size={20} aria-hidden="true" />
          <div>
            <strong>上一張收據已退回</strong>
            <span>{receipt.rejectionReason}</span>
          </div>
        </aside>
        <ReceiptSubmissionAction
          event={event}
          afterTimestamp={receipt.updatedAt}
          mode={mode}
          busy={busy}
          onSave={onSaveReceipt}
        />
      </div>
    );
  if (receipt?.status === "submitted")
    return (
      <ReceiptVerificationAction
        receipt={receipt}
        mode={mode}
        busy={busy}
        onSave={onSaveReceipt}
      />
    );
  if (event.status === "collected")
    return (
      <ReceiptSubmissionAction
        event={event}
        mode={mode}
        busy={busy}
        onSave={onSaveReceipt}
      />
    );
  return (
    <CollectionAction
      event={event}
      suggestedWeightG={suggestedWeightG}
      mode={mode}
      busy={busy}
      onSave={onSaveCollection}
    />
  );
}
