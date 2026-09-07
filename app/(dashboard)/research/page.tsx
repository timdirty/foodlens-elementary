"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import {
  ArrowUpRight,
  BookOpenText,
  ClipboardList,
  FileCheck2,
  ChartNoAxesCombined,
  LockKeyhole,
  PencilLine,
  Scale,
  UsersRound,
} from "lucide-react";
import { useFoodLens } from "@/components/data-provider";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  Panel,
} from "@/components/ui/page";
import {
  categoryStats,
  className,
  experimentResult,
  generateInsights,
} from "@/lib/analysis";
import { resolveProjectIdentity } from "@/lib/project-identity";
import proofStyles from "./research-proof.module.css";

export default function ResearchPage() {
  const { snapshot, scopedSnapshot, loading, mode } = useFoodLens();
  if (loading || !snapshot || !scopedSnapshot)
    return (
      <div className="page-wrap">
        <LoadingState />
      </div>
    );
  const sections = [...snapshot.researchSections]
    .filter((item) => item.isPublished)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const insights = generateInsights(scopedSnapshot);
  const experiment = experimentResult(scopedSnapshot);
  const topCategory = categoryStats(scopedSnapshot)[0];
  const studyDays = new Set(scopedSnapshot.meals.map((meal) => meal.servedOn))
    .size;
  const fieldNotes = [...scopedSnapshot.corrections]
    .sort((left, right) => right.correctedAt.localeCompare(left.correctedAt))
    .map((correction) => {
      const detection = scopedSnapshot.detections.find(
        (item) => item.id === correction.detectionId,
      );
      const scan = scopedSnapshot.scans.find(
        (item) => item.id === detection?.scanId,
      );
      const meal = scopedSnapshot.meals.find(
        (item) => item.id === scan?.mealRecordId,
      );
      if (!detection || !meal) return undefined;
      return {
        id: correction.id,
        date: meal.servedOn,
        schoolClass: className(snapshot, meal.classId),
        label: correction.correctedLabel,
        before: Math.round(detection.aiRemainingRatio * 100),
        after: Math.round(correction.correctedRemainingRatio * 100),
        observation: correction.note,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 3);
  const { projectName, subtitle } = resolveProjectIdentity(snapshot.profile);
  return (
    <div className="page-wrap research-wrap">
      <PageHeader
        eyebrow={`專題研究｜${projectName}`}
        title="我們先認菜單、量剩食，再追到下一餐與最後去向"
        description={`${subtitle}｜${mode === "demo-local" ? "這頁用可重現的模擬資料演練方法" : "這頁整理目前校園記錄"}；菜單、五源秤重、學生修正、人類決策與去向憑證都能回到同一餐。`}
        icon={BookOpenText}
        actions={
          <Link className="secondary-action" href="/admin">
            <PencilLine size={16} />
            教師編輯
          </Link>
        }
      />
      <section
        className={proofStyles.proofBoard}
        aria-labelledby="judge-proof-title"
      >
        <div className={proofStyles.proofQuestion}>
          <span>先看我們想回答什麼</span>
          <h2 id="judge-proof-title">
            把菜單、五源秤重與人工修正串起來，真的能幫下一餐做得更好嗎？
          </h2>
          <p>
            {mode === "demo-local" ? "模擬資料" : "校園資料"} · {studyDays}
            個獨立供餐日 · {scopedSnapshot.meals.length} 筆班級餐期 ·{" "}
            {scopedSnapshot.scans.length}
            份餐盤
          </p>
        </div>
        <div className={proofStyles.proofMetrics}>
          <article>
            <span>
              {mode === "demo-local" ? "我們先測試規律門檻" : "我們先檢查規律"}
            </span>
            <strong>{insights[0]?.title ?? "需要更多資料"}</strong>
            <small>{insights[0]?.evidence}</small>
            <Link href="/lab">查看計算依據</Link>
          </article>
          <article>
            <span>餐盤最常留下什麼</span>
            <strong>
              {topCategory
                ? `${topCategory.name} ${topCategory.rate.toFixed(1)}%`
                : "需要更多資料"}
            </strong>
            <small>
              {topCategory
                ? `${topCategory.dateCount} 個供餐日／${topCategory.count} 個辨識項目`
                : "尚未達門檻"}
            </small>
            <Link href="/lab">查看類別比較</Link>
          </article>
          <article>
            <span>再量一次有沒有改變</span>
            <strong>
              {experiment?.isValid
                ? `${(experiment.beforeRate * 100).toFixed(0)}% → ${(experiment.afterRate * 100).toFixed(0)}%`
                : "目前範圍樣本不足"}
            </strong>
            <small>
              {experiment?.isValid
                ? `下降 ${(experiment.pointDrop * 100).toFixed(1)} 個百分點；不等同因果`
                : "需同時符合期間順序、最低筆數與獨立供餐日"}
            </small>
            <Link href="/experiments">查看樣本與限制</Link>
          </article>
        </div>
      </section>
      <section
        className={proofStyles.fieldNotes}
        aria-labelledby="field-notes-title"
      >
        <header>
          <div>
            <span>
              {mode === "demo-local" ? "示範記錄格式" : "最近人工校正"}
            </span>
            <h2 id="field-notes-title">我們怎麼改正一筆初判？</h2>
          </div>
          <p>
            {mode === "demo-local"
              ? "尚未進入校園田野蒐集；以下用模擬資料展示系統會留下哪些可追溯欄位。"
              : "只保存班級層級紀錄，不收集學生姓名或學號。"}
          </p>
        </header>
        <div>
          {fieldNotes.length ? (
            fieldNotes.map((note) => (
              <article key={note.id}>
                <span>
                  {note.date.replaceAll("-", "/")}｜{note.schoolClass}
                  {mode === "demo-local" ? "｜模擬" : ""}
                </span>
                <h3>{note.label}：我們把餐盤邊界再看一次</h3>
                <dl>
                  <div>
                    <dt>影像初判</dt>
                    <dd>{note.before}%</dd>
                  </div>
                  <div>
                    <dt>學生校正</dt>
                    <dd>{note.after}%</dd>
                  </div>
                </dl>
                <p>我們看到：{note.observation}</p>
                <small>
                  我們接著問：同一菜色再觀察，並訪談口感、份量與遮擋情況。
                </small>
              </article>
            ))
          ) : (
            <EmptyState
              title="尚無人工校正紀錄"
              description="學生完成第一份餐盤校正後，這裡會留下初判、修正與下一個追問。"
            />
          )}
        </div>
      </section>
      <div className="research-layout">
        <aside className="research-index">
          <strong>研究目錄</strong>
          {sections.map((section) => (
            <a href={`#${section.slug}`} key={section.id}>
              <span>{String(section.sortOrder).padStart(2, "0")}</span>
              {section.title.replace(/^\d+｜/, "")}
            </a>
          ))}
          <div>
            <FileCheck2 size={18} />
            <strong>內容版本</strong>
            <span>示範資料版 · {snapshot.profile.updatedAt.slice(0, 10)}</span>
          </div>
        </aside>
        <div className="research-paper" role="document">
          {sections.length ? (
            sections.map((section) => (
              <article id={section.slug} key={section.id}>
                <span>{String(section.sortOrder).padStart(2, "0")}</span>
                <h2>{section.title.replace(/^\d+｜/, "")}</h2>
                <ReactMarkdown>{section.bodyMarkdown}</ReactMarkdown>
              </article>
            ))
          ) : (
            <EmptyState
              title="尚無已發布的研究章節"
              description="教師可到管理頁編寫研究背景、方法、限制與結果，再發布給評審查看。"
            />
          )}
        </div>
      </div>
      <section className="role-grid">
        <article>
          <span>
            <ClipboardList />
            工具先做什麼
          </span>
          <h2>把菜單與餐盤整理成可修改草稿</h2>
          <ul>
            <li>紙本菜單 OCR 只產生待確認菜色、角色與食譜欄位</li>
            <li>餐盤模型只提出食物類型與剩餘比例初判</li>
            <li>保留原文、模型名稱、版本、信心與警示</li>
            <li>不從照片假裝知道過敏原、供應批次或精確重量</li>
          </ul>
          <Link href="/workflow">看智慧菜單的人工確認</Link>
        </article>
        <article className="rules">
          <span>
            <ChartNoAxesCombined />
            系統接著算什麼
          </span>
          <h2>把同一套定義跑在每筆證據上</h2>
          <ul>
            <li>分開五類廢棄物，不把源頭與盤後混成一個總重</li>
            <li>用總剩食重量 ÷ 總供應重量計算加權比例</li>
            <li>樣本日數或差異未過門檻就不產生洞察</li>
            <li>供餐試算受 15%、8% 或 5% 安全上限限制</li>
          </ul>
          <Link href="/lab">看分析門檻與資料表</Link>
        </article>
        <article className="human">
          <span>
            <UsersRound />
            我們最後做什麼
          </span>
          <h2>八個角色各自負責，AI 沒有最後決定權</h2>
          <ul>
            <li>學生修正、導師確認現場、營養師審核安全</li>
            <li>團膳評估製備與配送，校方依權責決定</li>
            <li>家長與公開端只看去識別化摘要，不看餐盤影像</li>
            <li>處理端回填收據，校方核驗後才算已確認去向</li>
          </ul>
          <Link href="/trace">看交接、收據與核驗責任鏈</Link>
        </article>
      </section>
      <Panel className="ethics-ledger">
        <div>
          <LockKeyhole size={24} />
          <h2>隱私與資料治理</h2>
          <p>
            正式模式以教師登入、同校 RLS
            與私有圖片儲存隔離資料；公開訪客只能操作各自瀏覽器的示範沙盒。
            {snapshot.profile.privacyContact &&
            snapshot.profile.governanceReviewedAt
              ? `目前由 ${snapshot.profile.privacyContact} 負責，設定每 ${snapshot.profile.dataRetentionDays ?? 180} 天檢視資料。`
              : "正式蒐集前仍需由教師在啟用中心指定負責人、保存期限並確認拍攝規則。"}
          </p>
        </div>
        <div>
          <Scale size={24} />
          <h2>估計與科學誠信</h2>
          <p>
            照片重量不是秤重。前後差異不等同因果。沒有可信係數前，不呈現虛構碳排。
          </p>
        </div>
        <div>
          <FileCheck2 size={24} />
          <h2>工具使用紀錄</h2>
          <p>{snapshot.profile.aiDisclosure}</p>
        </div>
      </Panel>
      <Panel className="source-ledger">
        <h2>在地問題證據與公開參考</h2>
        <p>
          以臺北市公開文件和案例作為「為什麼值得研究」的背景；歷史統計不代表 115
          年現況，示範數字也不代表本校實測。
        </p>
        <div>
          <a
            href="https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=55614625852816D3"
            target="_blank"
            rel="noreferrer"
          >
            115 年 4 月｜免費午餐與廚餘總量分析方向 <ArrowUpRight size={15} />
          </a>
          <a
            href="https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=1A8C571175114B72&sms=72544237BBE4C5F6"
            target="_blank"
            rel="noreferrer"
          >
            115 年 2 月｜校園剩食減量案例 <ArrowUpRight size={15} />
          </a>
          <a
            href="https://www.doe.gov.taipei/News_Content.aspx?n=B3DDF0458F0FFC11&s=560BEBFFFBF2F337&sms=72544237BBE4C5F6"
            target="_blank"
            rel="noreferrer"
          >
            110 年發布｜108–109 年日均廚餘歷史統計 <ArrowUpRight size={15} />
          </a>
          <a
            href="https://www.gov.taipei/News_Content.aspx?n=EEC70A4186D4C828&s=33BF7DB316A68E2B&sms=87415A8B9CE81B16"
            target="_blank"
            rel="noreferrer"
          >
            午餐供應委員會與營養師決策角色 <ArrowUpRight size={15} />
          </a>
          <a
            href="https://www.hrps.tp.edu.tw/uploads/17031206742925Up5jOoc.pdf"
            target="_blank"
            rel="noreferrer"
          >
            112 年文件｜教育局淨零排放實施計畫 <ArrowUpRight size={15} />
          </a>
          <a
            href="https://www.dcsh.tp.edu.tw/news/%E8%87%BA%E5%8C%97%E5%B8%82115%E5%AD%B8%E5%B9%B4%E5%BA%A6%E7%A7%91%E6%8A%80%E4%BA%BA%E6%96%87%E7%B4%A0%E9%A4%8A%E6%95%99%E8%82%B2%E5%AF%A6%E6%96%BD%E8%A8%88%E7%95%AB%E4%B9%8B%E3%80%8C%E8%B7%A8/"
            target="_blank"
            rel="noreferrer"
          >
            115 學年度競賽公告 <ArrowUpRight size={15} />
          </a>
        </div>
      </Panel>
    </div>
  );
}
