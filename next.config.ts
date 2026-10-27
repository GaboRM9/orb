import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"], // native bindings stay out of the bundle
  experimental: { serverActions: { bodySizeLimit: "4mb" } }, // knowledge uploads; Vercel rejects request bodies over 4.5MB
  turbopack: {
    rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
  },
};

export default nextConfig;
