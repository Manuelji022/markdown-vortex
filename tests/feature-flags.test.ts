import { describe, expect, it } from "vitest";
import { isFeatureEnabled } from "../shared/feature-flags.js";

describe("feature flags", () => {
  it.each(["1", "on", "true", "yes", " TRUE "])(
    "enables a flag for %s",
    (value) => {
      expect(isFeatureEnabled(value)).toBe(true);
    },
  );

  it.each([undefined, "", "0", "false", "off", "no", "maybe"])(
    "leaves a flag disabled for %s",
    (value) => {
      expect(isFeatureEnabled(value)).toBe(false);
    },
  );
});
