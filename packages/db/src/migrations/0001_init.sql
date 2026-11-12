-- 0001_init.sql — initial schema (PRD §9 + N3 departments + D23 task_file_refs
-- + N4 studio_conversations/tasks.origin). Idempotent via IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  username TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_uq ON roles (name);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users (id),
  role_id TEXT NOT NULL REFERENCES roles (id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_uq ON departments (name);

CREATE TABLE IF NOT EXISTS user_departments (
  user_id TEXT NOT NULL REFERENCES users (id),
  department_id TEXT NOT NULL REFERENCES departments (id),
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  owner_id TEXT NOT NULL REFERENCES users (id),
  active_release_id TEXT,
  listing_state TEXT NOT NULL DEFAULT 'listed',
  category_id TEXT REFERENCES categories (id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_slug_uq ON agents (slug);

CREATE TABLE IF NOT EXISTS agent_drafts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  builder_id TEXT NOT NULL REFERENCES users (id),
  draft_payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'editing',
  review_note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS agent_drafts_agent_idx ON agent_drafts (agent_id);
CREATE INDEX IF NOT EXISTS agent_drafts_builder_idx ON agent_drafts (builder_id);

CREATE TABLE IF NOT EXISTS agent_releases (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  version TEXT NOT NULL,
  immutable_package_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_releases_version_uq ON agent_releases (agent_id, version);

CREATE TABLE IF NOT EXISTS agent_grants (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  can_use INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS agent_grants_agent_idx ON agent_grants (agent_id);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT REFERENCES users (id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS skills_slug_uq ON skills (slug);

CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills (id),
  version TEXT NOT NULL,
  package_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS skill_versions_uq ON skill_versions (skill_id, version);

CREATE TABLE IF NOT EXISTS skill_submissions (
  id TEXT PRIMARY KEY,
  submitter_id TEXT NOT NULL REFERENCES users (id),
  content_path TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'pending',
  reviewer_id TEXT REFERENCES users (id),
  review_note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS skill_submissions_state_idx ON skill_submissions (review_state);

CREATE TABLE IF NOT EXISTS skill_bindings (
  skill_id TEXT NOT NULL REFERENCES skills (id),
  builder_id TEXT NOT NULL REFERENCES users (id),
  granted_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (skill_id, builder_id)
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config_ref TEXT,
  config TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS resource_grants (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources (id),
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  actions TEXT NOT NULL DEFAULT 'read',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS resource_grants_resource_idx ON resource_grants (resource_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id),
  agent_release_id TEXT NOT NULL REFERENCES agent_releases (id),
  state TEXT NOT NULL DEFAULT 'pending',
  origin TEXT NOT NULL DEFAULT 'staff',
  mode TEXT NOT NULL DEFAULT 'restricted',
  input_summary TEXT,
  budget TEXT,
  lease_owner TEXT,
  lease_until INTEGER,
  session_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks (owner_id);
CREATE INDEX IF NOT EXISTS tasks_state_idx ON tasks (state);
CREATE INDEX IF NOT EXISTS tasks_lease_idx ON tasks (lease_until);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  safe_payload TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS task_events_seq_uq ON task_events (task_id, seq);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id),
  task_id TEXT REFERENCES tasks (id),
  storage_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  checksum TEXT NOT NULL,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS files_owner_idx ON files (owner_id);

CREATE TABLE IF NOT EXISTS task_file_refs (
  task_id TEXT NOT NULL REFERENCES tasks (id),
  file_id TEXT NOT NULL REFERENCES files (id),
  direction TEXT NOT NULL,
  PRIMARY KEY (task_id, file_id, direction)
);

CREATE TABLE IF NOT EXISTS session_refs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  session_path TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_refs_task_idx ON session_refs (task_id);

CREATE TABLE IF NOT EXISTS tool_policies (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES agent_releases (id),
  tool_id TEXT NOT NULL,
  resource_scope TEXT,
  allowed_actions TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS tool_policies_release_idx ON tool_policies (release_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users (id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  decision TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS usage_records_task_idx ON usage_records (task_id);

CREATE TABLE IF NOT EXISTS studio_conversations (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES agent_drafts (id),
  builder_id TEXT NOT NULL REFERENCES users (id),
  messages TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS studio_conversations_draft_idx ON studio_conversations (draft_id);

-- Seed the three platform roles (identity-access spec).
INSERT OR IGNORE INTO roles (id, name) VALUES ('role-admin', 'admin');
INSERT OR IGNORE INTO roles (id, name) VALUES ('role-builder', 'builder');
INSERT OR IGNORE INTO roles (id, name) VALUES ('role-employee', 'employee');
