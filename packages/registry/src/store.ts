/**
 * Immutable release snapshot store (agent-registry spec, D6/D20).
 *
 * Each release is written once into releases/<releaseId>/ as a canonical
 * manifest.json plus the draft payload; the directory is marked immutable
 * via permissions (best-effort) and a guard marker. Checksum = sha256 of
 * the canonical manifest — recorded in agent_releases and verified on load.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, type DraftPayload } from "./payload.js";

export interface ReleaseSnapshot {
  releaseId: string;
  agentId: string;
  version: string;
  payload: DraftPayload;
  checksum: string;
}

const IMMUTABLE_MARKER = ".immutable";

export class ReleaseStore {
  constructor(private readonly releasesDir: string) {}

  init(): void {
    mkdirSync(this.releasesDir, { recursive: true });
  }

  private dirFor(releaseId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(releaseId)) {
      throw new Error(`invalid release id: ${releaseId}`);
    }
    return join(this.releasesDir, releaseId);
  }

  /** Write the one-time immutable snapshot; refuses to overwrite. */
  writeSnapshot(params: {
    releaseId: string;
    agentId: string;
    version: string;
    payload: DraftPayload;
    publishedBy: string;
  }): ReleaseSnapshot {
    const dir = this.dirFor(params.releaseId);
    if (existsSync(join(dir, IMMUTABLE_MARKER))) {
      throw new Error(`release ${params.releaseId} is immutable and already exists`);
    }
    mkdirSync(dir, { recursive: true });
    const manifest = {
      schemaVersion: "1.0" as const,
      releaseId: params.releaseId,
      agentId: params.agentId,
      version: params.version,
      publishedBy: params.publishedBy,
      publishedAt: new Date().toISOString(),
      payload: params.payload,
    };
    const checksum = createHash("sha256")
      .update(canonicalJson(manifest))
      .digest("hex");
    writeFileSync(join(dir, "manifest.json"), canonicalJson(manifest), { mode: 0o444 });
    writeFileSync(join(dir, IMMUTABLE_MARKER), checksum, { mode: 0o444 });
    try {
      chmodSync(dir, 0o555);
    } catch {
      // Windows/best-effort: marker + checksum still guard integrity.
    }
    return {
      releaseId: params.releaseId,
      agentId: params.agentId,
      version: params.version,
      payload: params.payload,
      checksum,
    };
  }

  /** Load and verify a snapshot against its recorded checksum. */
  loadSnapshot(releaseId: string, expectedChecksum: string): ReleaseSnapshot {
    const dir = this.dirFor(releaseId);
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`release snapshot ${releaseId} not found`);
    }
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as {
      agentId: string;
      version: string;
      payload: DraftPayload;
    };
    const checksum = createHash("sha256").update(raw).digest("hex");
    if (checksum !== expectedChecksum) {
      throw new Error(
        `release ${releaseId} checksum mismatch: snapshot is corrupted or tampered`,
      );
    }
    return {
      releaseId,
      agentId: manifest.agentId,
      version: manifest.version,
      payload: manifest.payload,
      checksum,
    };
  }
}
