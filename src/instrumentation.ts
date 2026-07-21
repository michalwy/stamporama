// Next.js server boot hook. The actual work lives in `instrumentation-node.ts` and is loaded
// only in the Node.js runtime. The positive `=== "nodejs"` guard around the dynamic import lets
// the bundler dead-code-eliminate it when compiling this entry for the Edge runtime, so no
// server-only module (Prisma, fs, the GCS SDK which needs node's `stream`) is ever bundled for
// Edge. See `instrumentation-node.ts` for why the previous `!== "nodejs"` early-return didn't.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { start } = await import("./instrumentation-node");
    await start();
  }
}
