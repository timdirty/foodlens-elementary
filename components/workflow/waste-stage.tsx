"use client";

import { Scale, ShieldCheck } from "lucide-react";
import type { MeasurementReview } from "@/lib/evidence-chain";
import type { SchoolClass } from "@/lib/types";
import {
  DRAINAGE_STATES,
  WASTE_MEASUREMENT_METHODS,
  WASTE_SOURCES,
  type DrainageState,
  type WasteMeasurement,
  type WasteMeasurementMethod,
} from "@/lib/waste-intelligence";
import {
  DRAINAGE_LABELS,
  FOOD_CATEGORY_LABELS,
  MEASUREMENT_METHOD_LABELS,
  WASTE_SOURCE_COPY,
} from "@/components/workflow/workflow-copy";
import styles from "@/app/(dashboard)/workflow/workflow.module.css";

export type WasteStageNumberField =
  | "plannedDiners"
  | "actualDiners"
  | "suppliedEdibleG"
  | "observedDiners"
  | "plateSampleSupplyG";

export type WasteStageTextField = "servedOn" | "classId";

export interface WasteStageValue {
  servedOn: string;
  classId: string;
  plannedDiners: number;
  actualDiners: number;
  suppliedEdibleG: number;
  observedDiners: number;
  plateSampleSupplyG?: number;
  measurements: WasteMeasurement[];
  measurementReview?: MeasurementReview;
}

function numberFromInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function displayedNumber(
  key: string,
  value: number,
  requireExplicitReview: boolean,
  touchedFields: ReadonlySet<string>,
) {
  if (requireExplicitReview && value === 0 && !touchedFields.has(key))
    return "";
  return value;
}

export function WasteStage({
  value,
  classes,
  error,
  requireExplicitReview = false,
  touchedFields = new Set<string>(),
  onNumberFieldChange,
  onTextFieldChange,
  onMeasurementChange,
  onMeasurementReviewChange,
}: {
  value: WasteStageValue;
  classes: SchoolClass[];
  error?: string;
  requireExplicitReview?: boolean;
  touchedFields?: ReadonlySet<string>;
  onNumberFieldChange: (field: WasteStageNumberField, value: number) => void;
  onTextFieldChange: (field: WasteStageTextField, value: string) => void;
  onMeasurementChange: (
    measurementId: string,
    patch: Partial<WasteMeasurement>,
  ) => void;
  onMeasurementReviewChange: (confirmed: boolean) => void;
}) {
  return (
    <>
      <header className={styles.stageHeader}>
        <div>
          <span>STEP 02 · MEASURE</span>
          <h2>把「剩很多」拆成五個來源</h2>
          <p>
            毛重、皮重與瀝水狀態一起保存。總廚餘不等於學生吃剩；未供出、不可食與湯汁都要分開。
          </p>
        </div>
        <span className={styles.statusPill}>
          <Scale size={14} /> 電子秤優先
        </span>
      </header>

      <div className={styles.mealFacts}>
        <label>
          <span>供餐日期</span>
          <input
            type="date"
            value={value.servedOn}
            onChange={(event) =>
              onTextFieldChange("servedOn", event.target.value)
            }
          />
        </label>
        <label>
          <span>班級</span>
          <select
            value={value.classId}
            onChange={(event) =>
              onTextFieldChange("classId", event.target.value)
            }
          >
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>預計用餐人數</span>
          <input
            type="number"
            min="1"
            max="5000"
            inputMode="numeric"
            value={displayedNumber(
              "plannedDiners",
              value.plannedDiners,
              requireExplicitReview,
              touchedFields,
            )}
            placeholder={requireExplicitReview ? "請輸入" : undefined}
            onChange={(event) =>
              onNumberFieldChange(
                "plannedDiners",
                numberFromInput(event.target.value),
              )
            }
          />
        </label>
        <label>
          <span>實到用餐人數</span>
          <input
            type="number"
            min="0"
            max="5000"
            inputMode="numeric"
            value={displayedNumber(
              "actualDiners",
              value.actualDiners,
              requireExplicitReview,
              touchedFields,
            )}
            placeholder={requireExplicitReview ? "請輸入" : undefined}
            onChange={(event) =>
              onNumberFieldChange(
                "actualDiners",
                numberFromInput(event.target.value),
              )
            }
          />
        </label>
      </div>

      <div className={styles.measurementBanner}>
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>可比較量測規則</strong>
          <span>
            可食剩食建議使用「標準瀝水 30 秒＋電子秤」。AI
            估計會降低證據品質，畫面也會明確揭露。
          </span>
        </div>
      </div>

      <div className={styles.wasteGrid}>
        {WASTE_SOURCES.map((source) => {
          const measurement = value.measurements.find(
            (item) => item.source === source,
          );
          if (!measurement) return null;
          const copy = WASTE_SOURCE_COPY[source];
          return (
            <section className={styles.wasteCard} key={source}>
              <div className={styles.wasteCardHead}>
                <span className={styles.wasteIcon}>{copy.short}</span>
                <div>
                  <strong>{copy.title}</strong>
                  <small>{copy.description}</small>
                </div>
                <span className={styles.wasteType}>{copy.kind}</span>
              </div>
              <div className={styles.weightInputs}>
                <label>
                  <span>毛重（g）</span>
                  <input
                    aria-label={`${copy.title}毛重（公克）`}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={displayedNumber(
                      `${measurement.id}.grossG`,
                      measurement.grossG,
                      requireExplicitReview,
                      touchedFields,
                    )}
                    placeholder={requireExplicitReview ? "請秤重" : undefined}
                    onChange={(event) => {
                      const grossG = numberFromInput(event.target.value);
                      onMeasurementChange(measurement.id, {
                        grossG,
                        netG: Math.max(0, grossG - measurement.tareG),
                      });
                    }}
                  />
                </label>
                <label>
                  <span>容器皮重（g）</span>
                  <input
                    aria-label={`${copy.title}容器皮重（公克）`}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={displayedNumber(
                      `${measurement.id}.tareG`,
                      measurement.tareG,
                      requireExplicitReview,
                      touchedFields,
                    )}
                    placeholder={requireExplicitReview ? "請秤重" : undefined}
                    onChange={(event) => {
                      const tareG = numberFromInput(event.target.value);
                      onMeasurementChange(measurement.id, {
                        tareG,
                        netG: Math.max(0, measurement.grossG - tareG),
                      });
                    }}
                  />
                </label>
                <output aria-live="polite">
                  淨重
                  <b>{measurement.netG} g</b>
                </output>
              </div>
              <div className={styles.measurementOptions}>
                <label>
                  <span>瀝水狀態</span>
                  <select
                    value={measurement.drainage}
                    onChange={(event) =>
                      onMeasurementChange(measurement.id, {
                        drainage: event.target.value as DrainageState,
                      })
                    }
                  >
                    {DRAINAGE_STATES.map((item) => (
                      <option key={item} value={item}>
                        {DRAINAGE_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>量測方式</span>
                  <select
                    value={measurement.method}
                    onChange={(event) =>
                      onMeasurementChange(measurement.id, {
                        method: event.target.value as WasteMeasurementMethod,
                      })
                    }
                  >
                    {WASTE_MEASUREMENT_METHODS.map((item) => (
                      <option key={item} value={item}>
                        {MEASUREMENT_METHOD_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </label>
                {source === "plate-edible" && (
                  <label>
                    <span>主要剩食類別</span>
                    <select
                      value={measurement.foodCategory ?? "other"}
                      onChange={(event) =>
                        onMeasurementChange(measurement.id, {
                          foodCategory: event.target
                            .value as WasteMeasurement["foodCategory"],
                        })
                      }
                    >
                      {Object.entries(FOOD_CATEGORY_LABELS).map(
                        ([category, label]) => (
                          <option key={category} value={category}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className={styles.coverageFields}>
        <label>
          <span>全餐供應可食重量（g）</span>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={displayedNumber(
              "suppliedEdibleG",
              value.suppliedEdibleG,
              requireExplicitReview,
              touchedFields,
            )}
            placeholder={requireExplicitReview ? "請輸入" : undefined}
            onChange={(event) =>
              onNumberFieldChange(
                "suppliedEdibleG",
                numberFromInput(event.target.value),
              )
            }
          />
        </label>
        <label>
          <span>盤後抽樣人數／實到 {value.actualDiners} 人</span>
          <input
            type="number"
            min="0"
            max={value.actualDiners}
            inputMode="numeric"
            value={displayedNumber(
              "observedDiners",
              value.observedDiners,
              requireExplicitReview,
              touchedFields,
            )}
            placeholder={requireExplicitReview ? "請輸入" : undefined}
            onChange={(event) =>
              onNumberFieldChange(
                "observedDiners",
                numberFromInput(event.target.value),
              )
            }
          />
        </label>
        <label>
          <span>抽樣餐盤原供應重量（g）</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={displayedNumber(
              "plateSampleSupplyG",
              value.plateSampleSupplyG ?? 0,
              requireExplicitReview,
              touchedFields,
            )}
            placeholder={requireExplicitReview ? "請輸入" : undefined}
            onChange={(event) =>
              onNumberFieldChange(
                "plateSampleSupplyG",
                numberFromInput(event.target.value),
              )
            }
          />
        </label>
      </div>
      {requireExplicitReview && (
        <section
          className={styles.measurementReview}
          aria-labelledby="measurement-review-title"
        >
          <div>
            <strong id="measurement-review-title">正式量測人工確認</strong>
            <p id="measurement-review-help">
              這一步把草稿轉成可保存的現場證據；請逐項核對毛重、皮重、瀝水狀態與量測方式。
            </p>
          </div>
          <label className={styles.switchLabel}>
            <input
              type="checkbox"
              checked={Boolean(value.measurementReview)}
              aria-describedby="measurement-review-help"
              onChange={(event) =>
                onMeasurementReviewChange(event.target.checked)
              }
            />
            <span>我已逐項確認；空桶或 0 g 代表現場確實為零</span>
          </label>
          {value.measurementReview && (
            <small>
              確認角色：{value.measurementReview.reviewedBy}
              ；後續更改任一量測值會自動撤回確認。
            </small>
          )}
        </section>
      )}
      {error && (
        <p className={styles.validationError} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
