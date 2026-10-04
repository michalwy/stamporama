import { readFileSync } from "node:fs";
import path from "node:path";

// **The ECB, answered from recorded responses** (#1648). The integration suite used to read the live
// ECB, so a 504 from the ECB failed a required check on a pull request that had not touched rates —
// three runs in four on 2026-10-04. These are the ECB's own answers, recorded once:
//
// - `eurofxref-daily-2026-10-02.xml` — the daily reference-rate table, as
//   `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` served it on 2026-10-04;
// - `exr-chf-pln-2021-02-20-to-2021-03-07.csv` — the data API's CSV for CHF and PLN against EUR over
//   that window, as `https://data-api.ecb.europa.eu/service/data/EXR/D.PLN+CHF.EUR.SP00.A` served it.
//
// The data API is answered the way the ECB answers it: only the rows of the currencies the key names,
// inside `startPeriod`–`endPeriod`, and a 404 when nothing is left — so the code under test still
// builds its own request and parses a real response. Any other URL goes to the fetch that was there
// before, which a test may itself have replaced.

const DIR = path.join(process.cwd(), "tests/fixtures/ecb");
const DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const DATA_API = "https://data-api.ecb.europa.eu/service/data/EXR/D.";

const daily = readFileSync(path.join(DIR, "eurofxref-daily-2026-10-02.xml"), "utf8");
const historic = readFileSync(path.join(DIR, "exr-chf-pln-2021-02-20-to-2021-03-07.csv"), "utf8");

/** The data API's answer for one request, filtered out of the recorded CSV. */
function historicAnswer(url: URL): Response {
  const key = url.pathname.slice(url.pathname.indexOf("/EXR/D.") + "/EXR/D.".length);
  const currencies = new Set(key.split(".")[0].split("+"));
  const start = url.searchParams.get("startPeriod") ?? "";
  const end = url.searchParams.get("endPeriod") ?? "9999-12-31";
  const [header, ...rows] = historic.split(/\r?\n/).filter((line) => line.trim() !== "");
  const cells = header.split(",");
  const currencyAt = cells.indexOf("CURRENCY");
  const periodAt = cells.indexOf("TIME_PERIOD");
  // The leading columns are never quoted, so a plain split is exact up to TIME_PERIOD.
  const kept = rows.filter((row) => {
    const parts = row.split(",");
    return currencies.has(parts[currencyAt]) && parts[periodAt] >= start && parts[periodAt] <= end;
  });
  if (kept.length === 0) return new Response("No results found.", { status: 404 });
  return new Response([header, ...kept].join("\n"), { status: 200 });
}

/** Answer the ECB from the recorded responses until the returned function is called. */
export function installEcbStub(): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (href === DAILY_URL) return new Response(daily, { status: 200 });
    if (href.startsWith(DATA_API)) return historicAnswer(new URL(href));
    return previous(input, init);
  };
  return () => {
    globalThis.fetch = previous;
  };
}
