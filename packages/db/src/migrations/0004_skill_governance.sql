-- 0004: skill governance hardening (remediation 2.4/2.5/2.7).
-- is_scripted: package contains executable/dependency files -> sandboxed
-- runtime required (FR-04.5). revoked_by: revocations are attributable (D18).

ALTER TABLE skill_versions ADD COLUMN is_scripted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_versions ADD COLUMN revoked_by TEXT REFERENCES users(id);
