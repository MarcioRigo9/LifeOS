/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output (ARCHITECTURE.md §11): the production Dockerfile's web-runner stage
  // copies only .next/standalone + .next/static + public/ — a self-contained server.js with its
  // own minimal node_modules, not the full dependency tree `next start` would otherwise need.
  output: "standalone",
};

export default nextConfig;
