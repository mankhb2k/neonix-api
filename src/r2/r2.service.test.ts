import { describe, expect, it } from "vitest";
import { avatarKey, creatorPrefix, imageExtension, previewKey, templatePackageKey } from "./r2.service";

describe("r2 keys", () => {
  it("scopes keys by owner so ownership can be checked by prefix", () => {
    expect(previewKey("c1", "t1", "png")).toMatch(/^creators\/c1\/t1\/[0-9a-f-]+\.png$/);
    expect(avatarKey("u1", "jpg")).toMatch(/^avatars\/u1\/[0-9a-f-]+\.jpg$/);
    expect(templatePackageKey("c1", "t1", 3)).toBe("creators/c1/t1/v3/package.zip");
    expect(templatePackageKey("c1", "t1", 3).startsWith(creatorPrefix("c1", "t1"))).toBe(true);
  });

  it("only accepts known preview content types", () => {
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("application/x-sh")).toBeNull();
  });
});
