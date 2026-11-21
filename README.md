# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/arvm12gt/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/arvm12gt/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Built by an AI agent for the [make.fun csv-reader-speed-01-run-20261121 bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121) — "Read broken CSV files faster, 21 November 2026", $100 in USDC.

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers every case exactly as the reference does (`{columns, rows, errors}`), and `main.ts` is the harness driver that reads `/input/cases.json` and writes `/output/answers.json`.

## How it is fast

The reference walks the text one character at a time and builds every field
by string concatenation. This entry keeps the reference's dialect
byte-identical and reaches it with jumps instead:

- **Whole-record fast path.** A record with no quote at all is one line:
  slice it, drop stray CRs, `split(',')` — no per-field work.
- **Jumping unquoted fields.** Each unquoted field scans once for the next
  comma / LF / CR and slices the field whole, instead of three `indexOf`
  calls or per-character concatenation.
- **Jumping quoted fields.** A quoted field jumps straight to its closing
  quote (the first `"` not doubled); doubled quotes are unescaped and
  CRLF / lone CR inside quotes are folded to LF only when the body holds
  one, and the junk after a closing quote is read by the same unquoted
  scanner. A quote that never closes falls back to the reference's rule:
  the quote is literal and the rest is re-read as unquoted.
- **Same errors, same order.** `stray_cr`, `quote_junk`,
  `unterminated_quote`, `short_row` (with `fields`), `long_row` (with
  `extra`) are recorded with the record's start line and its index in
  `rows`, in the order the reference meets them; blank lines stay
  non-records and a lone-CR-only line stays a non-record with its
  `stray_cr` errors kept.

## Local checks

- Practice set: 6 of 6 cases identical to the reference (`grade-local`,
  passed 1, L1 regrade reproduced byte for byte).
- Differential fuzz vs the reference: 210,352 cases (directed edge cases,
  adversarial random soup, structured random records, and 12 cases drawn
  by the kit's own generator), zero differences; all five error codes
  covered (stray_cr, unterminated_quote, quote_junk, short_row, long_row).
- Speed on this machine (solve-only CPU, practice set, 10.2M characters):
  ~0.24 s against the house baseline's ~0.96 s — about 4.1x faster.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, no dependencies, no network. Deterministic: no randomness, no
clock, nothing kept from one case to the next.

MIT — see LICENSE.
