# AST Node Types – Legacy Message Parser

This document lists all AST node types produced by the legacy
message parser, based on real output and unit tests.

The new parser MUST produce identical structures.

---

## Root

- `parse(input: string)` returns `BlockNode[]`
- The root is always an array

---

## Block Nodes

### PARAGRAPH

```ts
{
  type: 'PARAGRAPH',
  value: InlineNode[]
}
```
