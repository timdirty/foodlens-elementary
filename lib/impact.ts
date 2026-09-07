import type { ImpactSettings } from "@/lib/types";

export function impactBarWidth(grams: number, yearGrams: number) {
  if (
    !Number.isFinite(grams) ||
    !Number.isFinite(yearGrams) ||
    grams < 0 ||
    yearGrams <= 0
  )
    return 0;
  return Math.min(100, Math.max(12, (grams / yearGrams) * 100));
}

export function calculateImpact(
  settings: ImpactSettings,
  improvementPercent: 5 | 10 | 20 | 30,
) {
  const ratio = improvementPercent / 100;
  const dailyG = settings.schoolDailyBaselineG * ratio;
  const weekG = dailyG * settings.schoolDaysPerWeek;
  const semesterG = weekG * settings.weeksPerSemester;
  const yearG = semesterG * settings.semestersPerYear;
  const cost = (grams: number) =>
    Math.round((grams / 1000) * settings.costTwdPerKg);
  return {
    improvementPercent,
    week: { grams: weekG, costTwd: cost(weekG) },
    semester: { grams: semesterG, costTwd: cost(semesterG) },
    year: { grams: yearG, costTwd: cost(yearG) },
  };
}
