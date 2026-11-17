-- 0005: task follow-up queue (remediation 2.12).
-- Employee continue/cancel replies are queued on the task and consumed by
-- the runner on the next execution round (waiting_input resume or terminal
-- continue requeue) — messages actually reach the model.

ALTER TABLE tasks ADD COLUMN pending_followup TEXT;
