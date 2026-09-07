import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function kg(grams: number, digits = 1) {
  return `${(grams / 1000).toFixed(digits)} kg`;
}
export function twd(value: number) {
  return new Intl.NumberFormat("zh-TW").format(Math.round(value));
}
