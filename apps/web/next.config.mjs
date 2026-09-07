/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@certus/shared"],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
