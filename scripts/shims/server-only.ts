// No-op shim: `server-only` throws outside a Next.js server runtime, and a maintenance script is
// exactly that — a Node process reaching into `src/lib` on purpose. The same shim the integration
// tests use, for the same reason.
export {};
