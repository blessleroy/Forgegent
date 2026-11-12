/**
 * Pi SDK adapter (design.md D2/D10).
 *
 * Thin, typed boundary over `@earendil-works/pi-coding-agent` so the rest of
 * the platform never imports the SDK directly. The exact SDK version is
 * pinned in package.json (no caret) because the package has changed npm
 * scopes historically; upgrades must go through this adapter.
 *
 * Placeholder scope (task 1.2): export the SDK surface we intend to build on
 * and a factory stub that will grow into the restricted/sandboxed session
 * factories in later tasks (2.2).
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ExecutionMode } from "@forgegent/shared";

export {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
};

export interface PlatformSessionOptions {
  /** Working directory for the task workspace. */
  cwd: string;
  /** Execution mode decides the wiring (restricted runs in-process for now). */
  mode: ExecutionMode;
  /** Allowlisted platform tool names passed to the SDK `tools` option. */
  toolAllowlist?: string[];
}

/**
 * Create a platform-governed agent session.
 *
 * Placeholder: constructs the SDK factories we will specialise per mode in
 * task 2.2 (restricted: in-process allowlisted tools; sandboxed: proxy-only
 * container wiring in M3).
 */
export async function createPlatformSession(_options: PlatformSessionOptions) {
  throw new Error(
    "createPlatformSession: not implemented yet (scheduled for task 2.2 — runner session factory)",
  );
}
