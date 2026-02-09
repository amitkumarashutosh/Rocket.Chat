# Message Parser – Tests as Specification

This document summarizes the behavior of the legacy message parser
as defined by existing unit tests in `packages/message-parser/tests/`.

The new parser implementation MUST preserve all behaviors listed here.

---

## General Rules

- `parse(input)` always returns an array of block nodes
- All inline content is wrapped inside `PARAGRAPH`
- The parser never throws errors on malformed input
- Malformed formatting is handled in a fail-soft manner

---

## bold.test.ts

- Single `*` and double `**` both produce `BOLD` nodes
- `BOLD.value` is an array of inline nodes
- Extra or malformed `*` characters may be preserved as plain text

---

## paragraph.test.ts

- Plain text is always wrapped in a `PARAGRAPH`
- Text is not split unless required by formatting
- Empty or simple input still produces a paragraph node

---

## quote.test.ts

- Lines starting with `>` produce `QUOTE` block nodes
- `QUOTE.value` contains one or more `PARAGRAPH` nodes
- Inline formatting is parsed inside quoted paragraphs

---

## inline-code.test.ts

- Inline code is delimited by backticks
- Content inside inline code is NOT parsed for formatting
- `INLINE_CODE.value` is a `PLAIN_TEXT` node, not an array

---

## malformed-input.test.ts (if present)

- Unclosed formatting markers are treated as literal text
- The parser never crashes or throws exceptions
- Partial matches are allowed and preserved

## free-text / paragraph parsing (test.each)

- Plain text is always wrapped in a `PARAGRAPH` node
- Punctuation (commas, slashes) does not split or affect text parsing
- Unexpected or unfinished formatting markers (e.g. `*bold_`) are treated as literal text
- The parser does not attempt to recover or partially parse invalid formatting
- Malformed input never causes an error
