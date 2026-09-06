const ENABLED_VALUES = new Set(["1", "on", "true", "yes"]);

export function isFeatureEnabled(value: string | undefined): boolean {
  return value !== undefined && ENABLED_VALUES.has(value.trim().toLowerCase());
}
