import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // The card database and images live outside the app; never trace them into the build.
  outputFileTracingExcludes: { '*': ['data/**'] },
};

export default nextConfig;
