import type { ProjectProfile } from "@/lib/types";

export const FALLBACK_PROJECT_IDENTITY = {
  projectName: "FoodLens 食光偵探",
  subtitle: "校園午餐剩食觀察與供餐改善",
} as const;

export function resolveProjectIdentity(
  profile: Pick<ProjectProfile, "projectName" | "subtitle">,
) {
  return {
    projectName:
      profile.projectName.trim() || FALLBACK_PROJECT_IDENTITY.projectName,
    subtitle: profile.subtitle.trim() || FALLBACK_PROJECT_IDENTITY.subtitle,
  };
}
