import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Silence the "multiple lockfiles" workspace root warning.
  // The Next.js app lives in /app — set turbopack root explicitly.
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
