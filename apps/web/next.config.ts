import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external — webpack tracing breaks the
  // prebuilt binding path otherwise (build/Release/better_sqlite3.node).
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
