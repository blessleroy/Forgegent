/**
 * Role → ability matrix (identity-access spec, PRD §2).
 *
 * Semantics (review-corrected): a multi-role user gets the UNION of their
 * roles' explicitly granted abilities — never an implicit upgrade (a Builder
 * never inherits Admin). Everything not granted is denied by default.
 */
import type { Role } from "./index.js";

export const ABILITIES = [
  "agent.draft.create",
  "agent.draft.edit",
  "agent.draft.test",
  "agent.draft.submit",
  "agent.draft.withdraw",
  "agent.release.review",
  "agent.release.publish",
  "agent.release.delist",
  "agent.release.rollback",
  "agent.release.export",
  "agent.release.import",
  "agent.use",
  "skill.submit",
  "skill.review",
  "skill.grant_binding",
  "resource.manage",
  "resource.grant",
  "model.manage",
  "user.manage",
  "audit.view",
  "usage.view",
  "admin.panel",
] as const;
export type Ability = (typeof ABILITIES)[number];

const EMPLOYEE_ABILITIES: readonly Ability[] = [
  "agent.use",
  "skill.submit",
];

const BUILDER_ABILITIES: readonly Ability[] = [
  ...EMPLOYEE_ABILITIES,
  "agent.draft.create",
  "agent.draft.edit",
  "agent.draft.test",
  "agent.draft.submit",
  "agent.draft.withdraw",
];

/** Admin holds every ability in the matrix. */
export const ADMIN_ABILITIES: readonly Ability[] = ABILITIES;

export const ROLE_ABILITIES: Readonly<Record<Role, readonly Ability[]>> = {
  admin: ADMIN_ABILITIES,
  builder: BUILDER_ABILITIES,
  employee: EMPLOYEE_ABILITIES,
};

/** Effective abilities = union of per-role explicit grants. */
export function effectiveAbilities(userRoles: readonly Role[]): Set<Ability> {
  const out = new Set<Ability>();
  for (const role of userRoles) {
    for (const ability of ROLE_ABILITIES[role]) out.add(ability);
  }
  return out;
}

/** Deny by default; grant only when explicitly listed above. */
export function can(
  userRoles: readonly Role[],
  ability: Ability,
): boolean {
  return effectiveAbilities(userRoles).has(ability);
}

/** Task/file/agent object-level checks live server-side near the data;
 * this matrix only answers role-level questions. */
export function hasAnyAdminRole(userRoles: readonly Role[]): boolean {
  return userRoles.includes("admin");
}
