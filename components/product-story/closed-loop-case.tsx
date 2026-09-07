import Link from "next/link";
import {
  ArrowRight,
  Camera,
  ChartNoAxesCombined,
  RefreshCw,
  ScanSearch,
  Truck,
  Utensils,
} from "lucide-react";
import { className, experimentResult, generateInsights } from "@/lib/analysis";
import { createPrediction } from "@/lib/prediction";
import type { AppSnapshot, DataMode } from "@/lib/types";
import { kg } from "@/lib/utils";
import styles from "./closed-loop-case.module.css";

const matchScore = {
  exact: 4,
  similar: 3,
  baseline: 2,
  insufficient: 1,
} as const;

export interface ClosedLoopStory {
  mealId: string;
  imageUrl?: string;
  date: string;
  schoolClass: string;
  menu: string;
  people: number;
  scanSource: string;
  detectionLabel: string;
  aiRatio: number;
  finalRatio: number;
  wasCorrected: boolean;
  finding: string;
  findingEvidence: string;
  plannedSupplyG: number;
  recommendedSupplyG: number;
  predictionEvidence: string;
  beforeRate?: number;
  afterRate?: number;
}

/**
 * Selects one traceable scan and derives every later step from the supplied
 * snapshot. The preferred case has a human correction and enough matching menu
 * history for an exact prediction, so the story never becomes a hard-coded
 * marketing example.
 */
export function buildClosedLoopStory(
  snapshot: AppSnapshot,
): ClosedLoopStory | undefined {
  const insights = generateInsights(snapshot);
  const experiment = experimentResult(snapshot);
  const candidates = snapshot.detections
    .map((detection) => {
      const scan = snapshot.scans.find((item) => item.id === detection.scanId);
      const meal = snapshot.meals.find(
        (item) => item.id === scan?.mealRecordId,
      );
      if (!scan || !meal || scan.status !== "confirmed") return undefined;
      const correction = snapshot.corrections.find(
        (item) => item.detectionId === detection.id,
      );
      const sameMenuDay = snapshot.meals.filter(
        (item) =>
          item.servedOn === meal.servedOn &&
          item.menuSignature === meal.menuSignature,
      );
      const people = sameMenuDay.reduce(
        (sum, item) => sum + item.actualPeople,
        0,
      );
      const plannedSupplyG = sameMenuDay.reduce(
        (sum, item) => sum + item.totalSupplyG,
        0,
      );
      const prediction = createPrediction(snapshot, {
        plannedPeople: people,
        menuName: `${meal.staple}｜${meal.mainDish}`,
        plannedSupplyG,
      });
      return { detection, scan, meal, correction, people, prediction };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort(
      (left, right) =>
        Number(Boolean(right.correction)) - Number(Boolean(left.correction)) ||
        matchScore[right.prediction.matchLevel] -
          matchScore[left.prediction.matchLevel] ||
        right.meal.servedOn.localeCompare(left.meal.servedOn) ||
        Math.abs(
          (right.correction?.correctedRemainingRatio ??
            right.detection.aiRemainingRatio) -
            right.detection.aiRemainingRatio,
        ) -
          Math.abs(
            (left.correction?.correctedRemainingRatio ??
              left.detection.aiRemainingRatio) -
              left.detection.aiRemainingRatio,
          ),
    );
  const selected = candidates[0];
  if (!selected) return undefined;

  const menuWords = [selected.meal.staple, selected.meal.mainDish]
    .flatMap((item) => item.split(/[｜・、\s]+/))
    .filter((item) => item.length >= 2);
  const finding =
    insights.find((item) =>
      menuWords.some((word) => item.title.includes(word)),
    ) ?? insights[0];

  return {
    mealId: selected.meal.id,
    imageUrl: selected.scan.imageUrl,
    date: selected.meal.servedOn,
    schoolClass: className(snapshot, selected.meal.classId),
    menu: `${selected.meal.staple}・${selected.meal.mainDish}`,
    people: selected.people,
    scanSource: selected.scan.provider,
    detectionLabel:
      selected.correction?.correctedLabel ?? selected.detection.label,
    aiRatio: selected.detection.aiRemainingRatio,
    finalRatio:
      selected.correction?.correctedRemainingRatio ??
      selected.detection.aiRemainingRatio,
    wasCorrected: Boolean(selected.correction),
    finding: finding?.title ?? "資料還沒達到規律門檻",
    findingEvidence: finding?.evidence ?? "再累積供餐日後重新檢查",
    plannedSupplyG: selected.prediction.plannedSupplyG,
    recommendedSupplyG: selected.prediction.recommendedSupplyG,
    predictionEvidence:
      selected.prediction.matchLevel === "insufficient"
        ? "相似紀錄不足，先維持原量"
        : `${selected.prediction.independentDateCount} 個獨立供餐日・${selected.prediction.sampleSize} 筆餐期`,
    beforeRate: experiment?.isValid ? experiment.beforeRate : undefined,
    afterRate: experiment?.isValid ? experiment.afterRate : undefined,
  };
}

export function ClosedLoopCase({
  snapshot,
  mode,
}: {
  snapshot: AppSnapshot;
  mode: DataMode;
}) {
  const story = buildClosedLoopStory(snapshot);
  const verifiedDestinationCount = snapshot.destinationReceipts.filter(
    (receipt) => receipt.status === "verified",
  ).length;
  const pendingDestinationCount = snapshot.destinationReceipts.filter(
    (receipt) => receipt.status === "submitted",
  ).length;
  if (!story) {
    return (
      <section className={styles.empty} aria-label="FoodLens 研究閉環">
        完成第一份已確認餐盤後，這裡會串起影像、人工確認、發現、供餐試算與再次量測。
      </section>
    );
  }

  const imageStyle = story.imageUrl
    ? {
        backgroundImage: `linear-gradient(180deg, transparent 32%, rgba(8, 29, 20, .86)), url(${JSON.stringify(story.imageUrl)})`,
      }
    : undefined;
  const nodes = [
    {
      icon: Camera,
      label: "拍下餐盤",
      value: `${story.date.slice(5).replace("-", "/")}・${story.schoolClass}`,
      note: `${story.menu}・${story.people} 人同日餐期`,
      href: `/records?meal=${story.mealId}`,
    },
    {
      icon: ScanSearch,
      label: story.wasCorrected ? "學生改正初判" : "學生確認初判",
      value: `${story.detectionLabel} ${Math.round(story.aiRatio * 100)}%${
        story.wasCorrected
          ? ` → ${Math.round(story.finalRatio * 100)}%`
          : "，確認不調整"
      }`,
      note: "原始值與人工結果可追溯",
      href: `/records?meal=${story.mealId}`,
    },
    {
      icon: ChartNoAxesCombined,
      label: "跨日找規律",
      value: story.finding,
      note: story.findingEvidence,
      href: "/lab",
    },
    {
      icon: Utensils,
      label: "試算下一餐",
      value:
        story.plannedSupplyG === story.recommendedSupplyG
          ? `${kg(story.plannedSupplyG)}，先不減量`
          : `${kg(story.plannedSupplyG)} → ${kg(story.recommendedSupplyG)}`,
      note: story.predictionEvidence,
      href: "/forecast",
    },
    {
      icon: RefreshCw,
      label: "再量一次",
      value:
        story.beforeRate !== undefined && story.afterRate !== undefined
          ? `${Math.round(story.beforeRate * 100)}% → ${Math.round(story.afterRate * 100)}%`
          : "尚未建立前後期",
      note:
        story.beforeRate !== undefined
          ? "前後差異不等同因果"
          : "記錄新餐期後再比較",
      href: "/experiments",
    },
  ];

  return (
    <section className={styles.story} aria-labelledby="closed-loop-story-title">
      <div
        className={styles.photo}
        style={imageStyle}
        role={story.imageUrl ? "img" : undefined}
        aria-label={story.imageUrl ? `${story.menu}餐盤照片` : undefined}
      >
        <span>{mode === "demo-local" ? "AI 生成照片" : "餐盤紀錄"}</span>
        <strong>{story.menu}</strong>
      </div>
      <div className={styles.content}>
        <header>
          <div>
            <span>一筆資料，怎麼走完改善循環</span>
            <h2 id="closed-loop-story-title">從這份餐盤，一路追到下一次量測</h2>
          </div>
          {mode === "demo-local" && <b>模擬閉環案例・非實測</b>}
        </header>
        <ol className={styles.nodes}>
          {nodes.map((node, index) => {
            const Icon = node.icon;
            return (
              <li key={node.label}>
                <Link
                  href={node.href}
                  aria-label={`${node.label}：${node.value}`}
                >
                  <span className={styles.nodeNumber}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Icon aria-hidden="true" />
                  <strong>{node.label}</strong>
                  <p>{node.value}</p>
                  <small>{node.note}</small>
                  <ArrowRight className={styles.openIcon} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ol>
        <p className={styles.methodNote}>
          照片只幫忙估食物類別與比例；餐期總量以班級電子秤為準，調整與否仍由學校決定。
        </p>
        <Link className={styles.traceLink} href="/trace">
          <Truck aria-hidden="true" />
          <span>
            <strong>第二條責任鏈：廚餘離校後去了哪裡？</strong>
            <small>
              {verifiedDestinationCount} 張處理場收據已核驗
              {pendingDestinationCount > 0
                ? `・${pendingDestinationCount} 張待核驗`
                : ""}
              ；預定去向不算成果
            </small>
          </span>
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
