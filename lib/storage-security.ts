/**
 * Private plate photos are display-only evidence. Keep browser authorization
 * short lived so copied URLs expire quickly while still surviving a demo view.
 */
export const PLATE_IMAGE_SIGNED_URL_TTL_SECONDS = 10 * 60;
