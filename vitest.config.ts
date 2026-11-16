import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const pkgs = ["shared", "pi-adapter", "db", "storage"];

export default defineConfig({
  resolve: {
    alias: pkgs.flatMap((name) => [
      {
        find: new RegExp(`^@forgegent/${name}/src/(.*)$`),
        replacement: resolve(__dirname, `packages/${name}/src/$1`),
      },
      {
        find: new RegExp(`^@forgegent/${name}$`),
        replacement: resolve(__dirname, `packages/${name}/src/index.ts`),
      },
    ]),
  },
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});
