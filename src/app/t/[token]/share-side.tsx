import { formatIssuedDate } from "@/app/stamp-display";
import type {
  TradeShareLineView,
  TradeShareSideView,
  TradeShareTotalsView,
} from "@/lib/trade-share";
import type { TradeSide } from "@/lib/trade-rules";
import { LineFeedback, ShareRow, SideRemarks } from "./feedback-controls";
import { SharePhotos } from "./share-photos";

// One side of one section, on the partner's page (#640).
//
// A **server** component. The collector's own column is a TanStack-backed client list with filters,
// an endless scroll and a row menu on every line; none of that has any business here. The partner
// has nothing to filter *with*, so there is no view of this list but all of it, and the whole list is
// already in the HTML by the time it arrives.
//
// The client code on the page hangs off each row: the feedback control (#641), which saves one
// line's answer the moment it is given, and the scans (#666), which enlarge on hover and open full
// size. The list around them is still one server render.
//
// The two sides are drawn by **one** component, unlike on the collector's screen where the give side
// is a copy row and the receive side is its own. That asymmetry exists there because the two really
// are different things to a collector — one is a copy with a number and a location, the other is a
// want key. To the partner they are both simply stamps, and the payload has already been reduced to
// the fields they share (`readTradeShareView`).

/** Money as the rest of the app prints it: a 2-dp figure with its currency code beside it. */
export function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

export function ShareSide({ side, token }: { side: TradeShareSideView; token: string }) {
  return (
    <div className="ts-side">
      <div className="ts-side-head">
        <span className="ts-side-title">{side.heading}</span>
        <span className="ts-side-count">{countText(side.totals)}</span>
      </div>
      {/* What this column already carries of the partner's own answers (#667) — scattered down a
          list of two hundred lines, they are otherwise findable only by re-reading it. */}
      <SideRemarks side={side.side} lineIds={side.lines.map((line) => line.lineId)} />

      {side.lines.length === 0 ? (
        <p className="ts-empty">Nothing on this side.</p>
      ) : (
        side.lines.map((line, index) => {
          // The path arrives **on the row**, cumulative, so the headings a row opens are simply the
          // suffix of its path the row before it did not share — the same derivation the collector's
          // own column makes, and the reason neither needs the page sent as a tree.
          const previous = index === 0 ? [] : side.lines[index - 1].path;
          const opening = line.path.filter((key, depth) => previous[depth] !== key);
          const openingFrom = line.path.length - opening.length;
          return (
            <div key={line.lineId}>
              {opening.map((key, i) => {
                const heading = side.headings[key];
                if (!heading) return null;
                return (
                  <div key={key} className="ts-group" data-depth={openingFrom + i}>
                    <span>{heading.label}</span>
                    {heading.detail && <span className="ts-group-detail">{heading.detail}</span>}
                    <span className="ts-group-count">
                      {heading.pieces === heading.count
                        ? heading.count
                        : `${heading.pieces} (${heading.count})`}
                    </span>
                  </div>
                );
              })}
              <ShareLineRow line={line} token={token} side={side.side} />
            </div>
          );
        })
      )}

      {side.truncated && (
        <p className="ts-empty">
          Only the first {side.lines.length} lines of this side are shown.
        </p>
      )}
    </div>
  );
}

/** *12 pieces (9 lines)*, or just the count where a line is a piece — which it always is on the give
 *  side, and routinely is not on the other. */
export function countText(totals: TradeShareTotalsView): string {
  if (totals.pieces === totals.lines) return `${totals.lines} ${totals.lines === 1 ? "stamp" : "stamps"}`;
  return `${totals.pieces} stamps (${totals.lines} lines)`;
}

function ShareLineRow({
  line,
  token,
  side,
}: {
  line: TradeShareLineView;
  token: string;
  side: TradeSide;
}) {
  const issued = formatIssuedDate(line.issuedDay, line.issuedMonth, line.issuedYear);
  return (
    // The row is drawn by a client wrapper so that what the partner says marks it the moment they
    // say it (#667); everything inside it is still server code.
    <ShareRow lineId={line.lineId}>
      {/* Kept even for a line with no pictures, so the text of every row starts in the same place.
          What goes in it is client code (#666) — the ids authorise nothing on their own, and the
          token's own route will not serve one that is not on this trade's lines. */}
      <div className="ts-thumbs">
        <SharePhotos token={token} photoIds={line.photoIds} />
      </div>

      <div className="ts-body">
        <div className="ts-line1">
          {line.primaryNumber && <span className="ts-cn">{line.primaryNumber}</span>}
          {line.name && <span className="ts-name">{line.name}</span>}
          {!line.primaryNumber && !line.name && <span className="ts-name">Stamp</span>}
          {line.otherNumbers.length > 0 && (
            <span className="ts-cn-other">{line.otherNumbers.join(" · ")}</span>
          )}
        </div>
        <div className="ts-line2">
          {/* **What has changed since we agreed** (#642). First on the line, ahead of the condition,
              because it is the one thing about this row that is no longer what the partner agreed
              to. Neutral wording: the two sides are headed by name above, so
              *Withdrawn* needs no *by whom*. */}
          {line.realisation && <span className="ts-struck">{line.realisation}</span>}
          <span className="ts-tag">{line.condition}</span>
          {line.certificate && <span className="ts-tag">{line.certificate}</span>}
          {line.format && <span className="ts-tag">{line.format}</span>}
          {/* Said plainly rather than left to be discovered in the envelope: the stamp is one of a
              group of variants and which one it is has not been recorded. */}
          {line.unknownVariant && <span className="ts-tag">variant not specified</span>}
          {line.areaPath && <span>{line.areaPath}</span>}
          {line.issueLabel && <span>{line.issueLabel}</span>}
          {issued && <span>{issued}</span>}
        </div>

        {/* What the partner has to say about this one line (#641). Under the stamp it is about,
            because that is the only place a note about it can be read without a second reference —
            and it changes nothing on the list, which is the whole bargain. */}
        <LineFeedback lineId={line.lineId} side={side} />
      </div>

      <div className="ts-right">
        {line.quantity !== 1 && <div className="ts-qty">×{line.quantity}</div>}
        {line.value && (
          <div className="ts-value">
            {money(line.value.amount, line.value.currency)}
            {(line.value.attribution || line.value.uncertain || line.value.manual) && (
              <span className="ts-value-note">
                {[
                  line.value.attribution,
                  line.value.uncertain ? "estimate" : null,
                  line.value.manual ? "own figure" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>
    </ShareRow>
  );
}
