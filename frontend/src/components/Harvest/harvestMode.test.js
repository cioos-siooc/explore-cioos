import { describe, it, expect } from "vitest";
import { harvestMode } from "./harvestMode.js";

describe("harvestMode", () => {
  it("is 'incremental' when the dataset has a content_hash", () => {
    expect(harvestMode({ content_hash: "abc123" })).toBe("incremental");
  });

  it("is 'full' when hashing was skipped for having no file list", () => {
    expect(
      harvestMode({ content_hash_reason: "HASH_NO_FILE_LIST" }),
    ).toBe("full");
  });

  it("is 'unknown' when neither applies, including with no dataset at all", () => {
    expect(harvestMode({})).toBe("unknown");
    expect(harvestMode()).toBe("unknown");
    expect(
      harvestMode({ content_hash_reason: "HASH_CROISSANT_HTTP_ERROR" }),
    ).toBe("unknown");
  });

  it("prefers content_hash over a hash_reason when both are somehow present", () => {
    expect(
      harvestMode({
        content_hash: "abc123",
        content_hash_reason: "HASH_NO_FILE_LIST",
      }),
    ).toBe("incremental");
  });
});
