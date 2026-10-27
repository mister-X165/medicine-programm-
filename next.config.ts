import type { NextConfig } from "next";

// =============================================================================
// SECURITY HEADERS (incident 2025-09-07 hardening)
// Applied to every response. Rationale:
//   - Content-Security-Policy: default everything to 'self'; allow the inline
//     styles Next.js/React need; scripts additionally allow 'unsafe-eval' +
//     'unsafe-inline' which the Next.js dev runtime (React Fast Refresh)
//     requires. No third-party origins are whitelisted: the app talks only to
//     itself in the browser (LM Studio / Минздрав calls are server-side).
//   - frame-ancestors 'none' + X-Frame-Options: DENY → clickjacking protection.
//   - nosniff → MIME-type sniffing protection.
//   - strict-origin-when-cross-origin → referrer leakage protection.
//   - Permissions-Policy → deny camera/mic/geo/payment/USB surfaces.
//   - HSTS → force HTTPS for browsers that reached the app over TLS.
//   - poweredByHeader: false → no framework fingerprint.
// =============================================================================

// v2.6: 'unsafe-eval' нужен ТОЛЬКО в dev (React Fast Refresh);
// в production eval запрещён (ужесточение CSP после аудита).
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), gyroscope=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "preview-chat-6bc2caed-466b-4f12-9939-589fb88dd05d.space-z.ai",
  ],
  reactStrictMode: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
