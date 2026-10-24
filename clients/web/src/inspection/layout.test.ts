import { describe, expect, it } from "vitest";

import { layoutForWidth, NARROW_MAX_WIDTH } from "./layout";

describe("layoutForWidth", () => {
  it("matches the stylesheets' narrow breakpoint", () => {
    expect(layoutForWidth(390)).toBe("phone");
    expect(layoutForWidth(NARROW_MAX_WIDTH)).toBe("phone");
    expect(layoutForWidth(NARROW_MAX_WIDTH + 1)).toBe("compact");
    expect(layoutForWidth(1_099)).toBe("compact");
    expect(layoutForWidth(1_100)).toBe("wide");
  });
});
