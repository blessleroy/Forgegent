import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const pkgs = [
  "shared",
  "pi-adapter",
  "db",
  "storage",
  "registry",
  "skills",
  "tasks",
  "studio",
  "gateway",
  "sandbox",
];

export default defineConfig({
  resolve: {
    alias: [
      // apps/web "@/..." path alias (needed by route/middleware imports in tests)
      {
        find: /^@\/(.*)$/,
        replacement: resolve(__dirname, "apps/web/src/$1"),
      },
      ...pkgs.flatMap((name) => [
        {
          find: new RegExp(`^@forgegent/${name}/src/(.*)$`),
          replacement: resolve(__dirname, `packages/${name}/src/$1`),
        },
        {
          find: new RegExp(`^@forgegent/${name}$`),
          replacement: resolve(__dirname, `packages/${name}/src/index.ts`),
        },
      ]),
    ],
  },
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});
