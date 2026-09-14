const ENABLED_VALUES = new Set(["1", "on", "true", "yes"]);

export function isFeatureEnabled(value: string | undefined): boolean {
  return value !== undefined && ENABLED_VALUES.has(value.trim().toLowerCase());
}

/** Temporary hard-off until YouTube transcript extraction is reliable again. */
export const YOUTUBE_AVAILABLE = false;

export function isYoutubeEnabled(value: string | undefined): boolean {
  return YOUTUBE_AVAILABLE && isFeatureEnabled(value);
}
