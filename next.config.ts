import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The local better-sqlite3 shim (vendor/) must stay external so `node:sqlite`
  // is required at runtime rather than bundled.
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
