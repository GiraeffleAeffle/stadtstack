# Domain docs

Stadtstack uses the single-context layout:

```
/
├── CONTEXT.md
└── docs/
    └── adr/
```

Before exploring a topic, read the root [`CONTEXT.md`](../../CONTEXT.md) and
the relevant accepted decisions in [`docs/adr/`](../adr/). Use the glossary's
canonical terms in issue titles, specifications, tests, and design notes. If
the code or a request contradicts the glossary or an ADR, surface the conflict
before changing the language or boundary.

The roadmap and the one-city product map are planning aids; they do not replace
the glossary or durable ADR decisions. `docs/wayfinder/` contains planning
indexes only, not hidden implementation requirements or an issue backlog.
