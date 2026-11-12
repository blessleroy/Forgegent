import { describe, expect, it } from "vitest";

describe("pi-adapter SDK surface", () => {
  it("resolves the pinned SDK exports as functions/type-carrying values", async () => {
    const sdk = await import("../src/index.js");
    expect(typeof sdk.createAgentSession).toBe("function");
    expect(typeof sdk.DefaultResourceLoader).toBe("function");
    expect(typeof sdk.ModelRuntime).toBe("function");
    expect(typeof sdk.SessionManager).toBe("function");
    expect(typeof sdk.SettingsManager).toBe("function");
  });

  it("exposes the platform session factory stub", async () => {
    const sdk = await import("../src/index.js");
    expect(typeof sdk.createPlatformSession).toBe("function");
    await expect(
      sdk.createPlatformSession({ cwd: "/tmp", mode: "restricted" }),
    ).rejects.toThrow(/task 2\.2/);
  });
});
