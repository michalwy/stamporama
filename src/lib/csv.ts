// Reading delimited text — pure, no Prisma and no `server-only`, so every judgement made about a
// file can be asserted against its bytes in `test:unit`.
//
// Written here rather than depended on: what arrives is a marketplace's own export, the rules are
// quotes, doubled quotes and separators-inside-quotes, and a parser that can be asserted against
// real samples is worth more than a dependency whose options would have to be settled anyway. It
// started inside the Delcampe reader (#611) and moved out when the Colnect list import (#645)
// needed the same three rules — one parser two readers agree on, rather than two that drift.

/** One record, and the **line of the file** it started on. */
export interface CsvRecord {
  /** 1-based, counting every line including the blank ones this reader drops — so a refusal names
   *  something the collector can find in the spreadsheet they are looking at. */
  line: number;
  fields: string[];
}

/**
 * Split delimited text into records of fields (RFC 4180), each carrying its own line number.
 *
 * `\r\n`, `\n` and a bare `\r` all end a record, since the file travels through whatever the
 * collector's browser and spreadsheet did to it on the way here. A line break **inside a quoted
 * field** does not: the record keeps the line it opened on, which is where a reader would point.
 *
 * A trailing newline does not produce an empty final record, and neither does a blank line anywhere
 * — a spreadsheet's parting gift, and not a record.
 */
export function parseCsvRecords(text: string, separator = ","): CsvRecord[] {
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let dirty = false;
  let line = 1;
  let startedOn = 1;

  const endField = () => {
    row.push(field);
    field = "";
    dirty = true;
  };
  const endRow = () => {
    if (dirty) records.push({ line: startedOn, fields: row });
    row = [];
    dirty = false;
  };
  /** The line a record starts on is the line its **first content** sits on, not the one the previous
   *  record ended above — blank lines in between belong to nobody. */
  const begin = () => {
    if (!dirty && field.length === 0) startedOn = line;
  };

  // A byte-order mark is a spreadsheet's convenience that would otherwise become part of the first
  // column's *name*, which is how a file that looks perfect reads as having none of the columns it
  // plainly has.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n" || (char === "\r" && source[i + 1] !== "\n")) line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      begin();
      quoted = true;
      dirty = true;
      continue;
    }
    if (char === separator) {
      begin();
      endField();
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      if (dirty || field.length > 0) endField();
      line += 1;
      endRow();
      continue;
    }
    begin();
    field += char;
  }
  if (dirty || field.length > 0) endField();
  endRow();

  // A record of nothing but empty fields is a blank line the walk above could not tell from a real
  // one.
  return records.filter((record) => record.fields.some((value) => value.trim().length > 0));
}

/** The fields alone, for readers that number their own rows. */
export function parseCsvRows(text: string, separator = ","): string[][] {
  return parseCsvRecords(text, separator).map((record) => record.fields);
}
