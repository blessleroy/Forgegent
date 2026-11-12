import { describe, expect, it } from "vitest";

describe("runner skeleton", () => {
  it("module loads without side effects on import of shared contracts", async () => {
    const shared = await import("@forgegent/shared");
    expect(shared.TASK_STATES.length).toBe(8);
  });
});
