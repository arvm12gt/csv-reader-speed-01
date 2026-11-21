// csv-reader-speed: a fast drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly csv-reader 1.0.0's answer ({columns, rows, errors})
// for every input, reached by indexOf-driven jumps instead of the reference's
// character-at-a-time walk: a record with no quote at all is split at once,
// unquoted fields jump to the next comma / line break / CR, and quoted fields
// jump straight to their closing quote. The dialect is the reference's own:
// a U+FEFF at the start is dropped; a record ends at LF or CRLF and a line
// with no characters is no record; outside quotes a CR not followed by LF is
// dropped (stray_cr); a field opening with a quote runs to the next quote
// that is not doubled ("" is one quote, each CRLF or lone CR inside it reads
// as LF), what follows its closing quote is appended as it stands
// (quote_junk, when the field ends), and a quote that never closes is a
// literal character whose following text is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is literal; fields
// are never trimmed or converted; header=true makes the first record the
// columns, rows are padded (short_row, with fields: its count) or cut
// (long_row, with extra: the cut fields) to the first record's width; each
// error is {code, line, row} in the order met, line the 1-based line its
// record starts on, row its index in rows (null for the header).

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function strayCr() {
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
  }

  // Reads each CRLF or lone CR in `s` as one LF, counting the lines crossed.
  function foldBreaks(s) {
    let out = '';
    let i = 0;
    for (;;) {
      const cr = s.indexOf('\r', i);
      const lf = s.indexOf('\n', i);
      let m = -1;
      let isCr = false;
      if (cr !== -1) {
        m = cr;
        isCr = true;
      }
      if (lf !== -1 && (m === -1 || lf < m)) {
        m = lf;
        isCr = false;
      }
      if (m === -1) {
        out += s.slice(i);
        return out;
      }
      out += s.slice(i, m);
      out += '\n';
      line += 1;
      i = m + 1;
      if (isCr && s.charCodeAt(m + 1) === 10) i = m + 2;
    }
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field and how
  // it ended; `added` counts the characters kept here. The scan walks the
  // field once and slices it whole, which beats three indexOf calls for the
  // short fields this dialect mostly holds.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      let p = pos;
      while (p < n) {
        const c = text.charCodeAt(p);
        if (c === 44 || c === 10 || c === 13) break;
        p += 1;
      }
      if (p >= n) {
        added += n - pos;
        value += text.slice(pos);
        pos = n;
        return { value, ended: END, added };
      }
      const c = text.charCodeAt(p);
      if (c === 44) {
        added += p - pos;
        value += text.slice(pos, p);
        pos = p + 1;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        added += p - pos;
        value += text.slice(pos, p);
        pos = p + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (text.charCodeAt(p + 1) === 10) {
        added += p - pos;
        value += text.slice(pos, p);
        pos = p + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A lone CR: dropped, and the field goes on.
      added += p - pos;
      value += text.slice(pos, p);
      strayCr();
      pos = p + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    // The closing quote: the first '"' not doubled.
    let p = pos;
    let q = -1;
    for (;;) {
      q = text.indexOf('"', p);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        p = q + 2;
        continue;
      }
      break;
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    // The quoted body: each CRLF or lone CR inside it reads as LF, and ""
    // inside it is one quote.
    let value = text.slice(pos, q);
    if (value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1) value = foldBreaks(value);
    if (value.indexOf('"') !== -1) value = value.replaceAll('""', '"');
    pos = q + 1;
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Puts a finished record where it goes: the header, or a row padded or cut
  // to the first record's width, with its short_row or long_row error.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quote at all is one line, split at once.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? n : nl;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1) {
      let body = seg;
      if (nl === -1) {
        pos = n;
      } else {
        pos = nl + 1;
        line += 1;
        // A CR at the end of the line is the CRLF line break, not a stray CR.
        if (body.charCodeAt(body.length - 1) === 13) body = body.slice(0, -1);
      }
      if (body.indexOf('\r') !== -1) {
        // Every other CR is stray: dropped, one stray_cr error each.
        const parts = body.split('\r');
        for (let i = 1; i < parts.length; i++) strayCr();
        body = parts.join('');
      }
      const fields = body.split(',');
      // A line that held only stray CRs is left with no characters: no record
      // (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '') continue;
      finishRecord(fields);
      continue;
    }

    // Slow path: the record holds a quote; read it field by field.
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
