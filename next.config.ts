import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

process.env.NEXT_TELEMETRY_DISABLED = "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheHandler: require.resolve("./lib/noop-cache-handler"),
  cacheMaxMemorySize: 0,
  cleanDistDir: true,
  generateEtags: false,
  env: {
    NEXT_TELEMETRY_DISABLED: "1",
  },

  generateBuildId: async () => {
    return `no-cache-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  },

  images: {
    unoptimized: true,
  },

  onDemandEntries: {
    maxInactiveAge: 0,
    pagesBufferLength: 0,
  },

  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, no-transform, must-revalidate",
          },
          {
            key: "X-Accel-Buffering",
            value: "no",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "frame-src https://*.e2b.dev https://*.e2b.app https://va.vercel-scripts.com",
              "frame-ancestors 'self' https://*.e2b.dev https://*.e2b.app",
              "connect-src 'self' https://*.e2b.dev https://*.e2b.app",
              "img-src 'self' data: https://*.e2b.dev https://*.e2b.app",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.e2b.dev https://*.e2b.app https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
            ].join("; "),
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
