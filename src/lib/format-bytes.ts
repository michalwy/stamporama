/** Human-readable file size using binary (IEC) units — B, KiB, MiB, GiB, TiB — where each step
 * is 1024 of the previous. Labels match the base: 1024 ⇒ the -bi- units (KiB…), never the SI
 * KB/MB (which are base-1000). Shared by any UI that surfaces storage sizes (e.g. per-collection
 * photo storage, #144). Client-safe (no server-only imports). Values ≥ 10 in a unit show no
 * decimals; smaller values show one. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  const rounded = exponent === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[exponent]}`;
}
