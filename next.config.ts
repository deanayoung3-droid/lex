import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server in .next/standalone for the Docker image.
  output: "standalone",
  // Loaded by Node at runtime rather than bundled: PGlite ships WebAssembly and data files.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  // The Next.js badge would sit inside the chat's frame in development.
  devIndicators: false,
  // The chat (/chat) is meant to sit in a frame on your website; the admin never is.
  async headers() {
    const noFrames = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      { source: "/admin/:path*", headers: noFrames },
      { source: "/login", headers: noFrames },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
