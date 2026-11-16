import { describe, expect, it } from "vitest";
import { can, effectiveAbilities } from "../src/permissions.js";

describe("role ability matrix (identity-access spec)", () => {
  it("employee can use agents and submit skills, nothing more", () => {
    expect(can(["employee"], "agent.use")).toBe(true);
    expect(can(["employee"], "skill.submit")).toBe(true);
    expect(can(["employee"], "agent.draft.create")).toBe(false);
    expect(can(["employee"], "agent.release.publish")).toBe(false);
    expect(can(["employee"], "admin.panel")).toBe(false);
  });

  it("builder can build and submit but never review/publish/admin", () => {
    expect(can(["builder"], "agent.draft.create")).toBe(true);
    expect(can(["builder"], "agent.draft.submit")).toBe(true);
    expect(can(["builder"], "agent.use")).toBe(true);
    expect(can(["builder"], "agent.release.review")).toBe(false);
    expect(can(["builder"], "agent.release.publish")).toBe(false);
    expect(can(["builder"], "admin.panel")).toBe(false);
    expect(can(["builder"], "user.manage")).toBe(false);
  });

  it("builder does not inherit admin", () => {
    // A builder alone must not pass any admin-only check.
    expect(can(["builder"], "skill.grant_binding")).toBe(false);
    expect(can(["builder"], "resource.manage")).toBe(false);
  });

  it("multi-role union: builder+employee keeps builder powers", () => {
    const abilities = effectiveAbilities(["builder", "employee"]);
    expect(abilities.has("agent.draft.create")).toBe(true);
    expect(abilities.has("agent.use")).toBe(true);
    expect(abilities.has("agent.release.publish")).toBe(false);
  });

  it("multi-role union: builder+admin gains admin powers explicitly", () => {
    expect(can(["builder", "admin"], "agent.release.publish")).toBe(true);
    // Still no invented abilities outside the matrix.
    expect(can(["builder", "admin"], "undefined.ability" as never)).toBe(false);
  });

  it("admin holds every ability", () => {
    expect(can(["admin"], "agent.release.publish")).toBe(true);
    expect(can(["admin"], "agent.draft.create")).toBe(true);
    expect(can(["admin"], "audit.view")).toBe(true);
  });

  it("empty roles deny everything", () => {
    expect(can([], "agent.use")).toBe(false);
    expect(effectiveAbilities([]).size).toBe(0);
  });
});
