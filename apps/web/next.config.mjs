import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve("../../.env.example") });
config({ path: resolve("../../.env"), override: true });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@certus/shared"],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
