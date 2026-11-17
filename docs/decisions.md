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
| 8 | Sandbox | Rootless Docker per-session containers via DockerBackend (docker CLI, internal network + controlled proxy as the ONLY egress); LocalProcessBackend stays for dev/tests; gVisor adapter slot via the ExecutionBackend interface. Pi orchestrates on the HOST — untrusted commands (sandbox.exec tool) run inside the session container. Docker daemon unreachable → sandboxed tasks fail with a structured reason; restricted tasks unaffected. |
| 9 | Model endpoint | Admin-configured OpenAI-compatible base URL + images API; API key resolved from env at call time, never persisted |
| 10 | Skill governance | Admin review + content-hash-locked versions; revocation blocks new bindings only (D18), records the revoking admin; script-bearing skills require the binding agent to run sandboxed (FR-04.5); generated skills embedded in an app package ride the SAME approval (D46 连带审核) |

## Session decisions from the le-spec workflow

Full traceability lives in `openspec/le-spec/state.md` (D1–D27, N1–N7 from
the v1-platform round; D28–D47, N8–N11 from the v1-remediation round).
Highlights that shaped the implementation:

- **D12** Platform UI is bilingual zh/EN (user decision, V1 scope);
  agent application content language is builder-controlled.
- **D27** `waiting_input` + terminal-state continuations share one
  message-style endpoint (user chose message flow over structured cards).
- **D28–D47** remediation round: single change with four task groups; LLM
  builder backend (in-process OpenAI-compatible chat, offline-heuristic
  fallback labelled 离线演示模式); `request_input` hang-up tool + pi-native
  session resume (`SessionManager.open`) so employee replies actually reach
  the model; DockerBackend with internal-network egress through the
  controlled proxy; per-token proxy allowlists; submit gate runs the test
  cases as a real isolated origin=test task (offline → labelled, never
  blocking); idempotency records persisted in SQLite; admin-configurable
  per-M-token pricing drives estimated_cost and the fee budget (unset →
  cost 0 + explicit note).
- **N1** Agents without explicit grants are admin-only (safe default).
- **N5** Submit-time auto-test failures never block review; results attach
  to the review materials.
- **N11 (open)** ZIP-format skill submissions need an unzip dependency —
  JSON `files` map submissions are live; ZIP awaits a dependency decision.
