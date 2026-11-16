# Forgegent — Design Decisions (docs/decisions.md per PRD §0.7)

Requirement blanks found during implementation adopt these defaults; none
reverse or widen the PRD scope.

| # | Decision | Value |
|---|---|---|
| 1 | Deployment | Single-enterprise instance, web + runner in one Compose file |
| 2 | Database | SQLite WAL, single file at `data/forgegent.sqlite` |
| 3 | Task queue | SQLite task table + lease-based single runner (no MQ) |
| 4 | Files | Local workspace under `data/files/` + `data/releases/` |
| 5 | Auth | Better Auth with env-var initial admin; first login forces a password change |
| 6 | Agent core | pi SDK `@earendil-works/pi-coding-agent@1.5.2` (exact pin) |
| 7 | UI | Schema-driven form-result + document-flow templates (custom React is P1) |
| 8 | Sandbox | Rootless Docker per-session containers (LocalProcessBackend for dev/test; gVisor adapter slot via ExecutionBackend interface) |
| 9 | Model endpoint | Admin-configured OpenAI-compatible base URL + images API; API key resolved from env at call time, never persisted |
| 10 | Skill governance | Admin review + content-hash-locked versions; revocation blocks new bindings only (D18) |

## Session decisions from the le-spec workflow

Full traceability lives in `openspec/le-spec/state.md` (D1–D27, N1–N7).
Highlights that shaped the implementation:

- **D12** Platform UI is bilingual zh/EN (user decision, V1 scope);
  agent application content language is builder-controlled.
- **D27** `waiting_input` + terminal-state continuations share one
  message-style endpoint (user chose message flow over structured cards).
- **N1** Agents without explicit grants are admin-only (safe default).
- **N5** Submit-time auto-test failures never block review; results attach
  to the review materials.
