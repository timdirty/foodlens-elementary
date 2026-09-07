const AUTH_CODE_MIN_LENGTH = 16;
const AUTH_CODE_MAX_LENGTH = 2048;

export const AUTH_CALLBACK_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export function isValidAuthCallbackCode(value: string | null): value is string {
  if (!value) return false;
  return (
    value.length >= AUTH_CODE_MIN_LENGTH &&
    value.length <= AUTH_CODE_MAX_LENGTH &&
    !/[\u0000-\u001f\u007f\s]/.test(value)
  );
}

export function authCallbackDestination(
  requestUrl: string,
  status: "ready" | "error",
) {
  const destination = new URL("/admin", requestUrl);
  destination.searchParams.set("cloud", status);
  return destination;
}
