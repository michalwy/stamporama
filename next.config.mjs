/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the GCS SDK (and its native/node-builtin-using deps like `paginator`) out of the
  // bundle — it's a server-only package that must be `require`d at runtime, not compiled into
  // the instrumentation/Edge bundle. Without this, webpack tries to bundle it for the Edge
  // runtime and fails to resolve node builtins (`Can't resolve 'stream'`), and every recompile
  // re-bundles the whole SDK. `resolveUrl`/uploads only ever run in the Node.js runtime.
  serverExternalPackages: ["@google-cloud/storage"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next"
};

export default nextConfig;
