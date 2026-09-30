/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the GCS SDK (and its native/node-builtin-using deps like `paginator`) out of the
  // bundle — it's a server-only package that must be `require`d at runtime, not compiled into
  // the instrumentation/Edge bundle. Without this, webpack tries to bundle it for the Edge
  // runtime and fails to resolve node builtins (`Can't resolve 'stream'`), and every recompile
  // re-bundles the whole SDK. `resolveUrl`/uploads only ever run in the Node.js runtime.
  serverExternalPackages: ["@google-cloud/storage"],
  // `typescript.ignoreBuildErrors` is deliberately left off (#889), so `pnpm build` fails on a type
  // error on its own, whether or not anything else ran. That costs one `tsc` pass paid twice in
  // `Static checks` — 42–61 s inside `next build` on CI, beside `pnpm typecheck` — and it is kept
  // on purpose: a person running `pnpm build` locally is asking whether their change compiles, and
  // the Dockerfile's builder stage type-checks nothing else. Turning it off saved nothing
  // measurable either: `Static checks` finishes 50–190 s under `Integration tests`, which sets a
  // required run's wall clock. Reopen it only when that ceiling has moved below this job.
  distDir: process.env.NEXT_DIST_DIR ?? ".next"
};

export default nextConfig;
