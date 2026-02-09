---

## What to write (based only on evidence)

```md
# Edge Cases – Legacy Parser Behavior

## Malformed Formatting

- Unclosed formatting markers are treated as literal text
- Unexpected marker combinations are preserved
- Parser may partially parse malformed input
- Parser does not attempt to auto-correct input

## Stability Guarantees

- Parser never throws exceptions
- Parser never crashes on invalid input
- Parser always returns a valid AST

## Inline Code

- Inline code blocks all nested parsing
- Formatting inside backticks is ignored

## Quotes

- Quotes always wrap content in PARAGRAPH nodes
- Nested formatting inside quotes is parsed normally
```
