import { describe, expect, it } from "vitest";
import { isPublicAddress, validatePublicUrl } from "../server/fetch-html.js";
import { ExtractionFailure } from "../server/errors.js";

describe("URL security", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("rejects localhost before fetching", async () => {
    await expect(validatePublicUrl("http://127.0.0.1/article")).rejects.toMatchObject({
      code: "blocked_url",
    } satisfies Partial<ExtractionFailure>);
  });

  it("rejects unsupported protocols", async () => {
    await expect(validatePublicUrl("file:///etc/passwd")).rejects.toMatchObject({
      code: "invalid_url",
    } satisfies Partial<ExtractionFailure>);
  });
});
