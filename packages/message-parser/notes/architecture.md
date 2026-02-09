# Message Parser Rewrite – Architecture

## Context

The current message parser is generated using PeggyJS.
While correct, the generated parser adds bundle size overhead
and creates performance bottlenecks.

The goal is to replace it with a more maintainable and performant
implementation while preserving exact AST behavior.

---

## Chosen Approach

- Use Chevrotain for tokenization and grammar definition
- Produce a Concrete Syntax Tree (CST)
- Convert CST into the existing legacy AST format

---

## Parsing Pipeline

input string
↓
Chevrotain Lexer (tokens)
↓
Chevrotain Parser (CST)
↓
CST → AST transformation
↓
Legacy-compatible AST

---

## Key Design Decisions

- AST shape is fixed and defined by legacy behavior
- Grammar rules never construct AST nodes directly
- All AST nodes are created in a dedicated AST builder
- Fail-soft behavior must be preserved (no throwing)

---

## Non-goals

- No syntax changes
- No new formatting features
- No behavior cleanup or fixes
