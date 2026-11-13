/**
 * Sandbox session manager (task 7.2): per-session containers with on-demand
 * start, multi-round reuse, idle expiry (15 min default), persist-then-
 * recycle semantics, and restore-on-next-acquire (AT-14).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AcquireOptions,
  ExecutionBackend,
  ResourceLimits,
  SessionHandle,
} from "./backends.js";

export interface ManagedSession {
  handle: SessionHandle;
  lastAccessAt: number;
}

export interface SandboxEvents {
  onReuse?(sessionId: string): void;
  onRecycle?(sessionId: string, persistedTo: string): void;
}

export class SandboxManager {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(
    private readonly backend: ExecutionBackend,
    private readonly persistRoot: string,
    private readonly events: SandboxEvents = {},
    private readonly idleMs = 15 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {
    mkdirSync(persistRoot, { recursive: true });
  }

  persistDirFor(sessionId: string): string {
    return join(this.persistRoot, sessionId);
  }

  /** Acquire: reuse a live session or start one (restoring persisted state). */
  async acquire(
    sessionId: string,
    options?: AcquireOptions,
    limits?: ResourceLimits,
  ): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessAt = this.now();
      this.events.onReuse?.(sessionId);
      return existing.handle;
    }
    const handle = await this.backend.acquireSession(sessionId, {
      restoreFromDir: this.persistDirFor(sessionId),
      ...options,
    }, limits);
    this.sessions.set(sessionId, { handle, lastAccessAt: this.now() });
    return handle;
  }

  /** Idle sweep: persist workspace then release (15-minute default). */
  async sweepIdle(): Promise<string[]> {
    const recycled: string[] = [];
    for (const [sessionId, managed] of [...this.sessions.entries()]) {
      if (this.now() - managed.lastAccessAt >= this.idleMs) {
        const persistDir = this.persistDirFor(sessionId);
        await this.backend.releaseSession(managed.handle, persistDir);
        this.sessions.delete(sessionId);
        this.events.onRecycle?.(sessionId, persistDir);
        recycled.push(sessionId);
      }
    }
    return recycled;
  }

  /** Immediate teardown for cancel/crash (7.6) — persisting first. */
  async teardown(sessionId: string): Promise<string | null> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;
    const persistDir = this.persistDirFor(sessionId);
    await this.backend.releaseSession(managed.handle, persistDir);
    this.sessions.delete(sessionId);
    return persistDir;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
