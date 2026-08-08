# Contributing

Keep changes small, testable, and municipality-neutral. Start with
`CONTEXT.md` and the relevant ADR before changing an Interface or domain term.

## Pull requests

- explain the highest public Seam changed and its Interface;
- include focused tests and a deterministic synthetic fixture where useful;
- preserve role isolation, redaction, checksums, and
  `authorityBinding: none` in local proof;
- do not add real identities, PII, credentials, private evidence, city-owned
  source records, deployment manifests, or operations receipts; and
- do not copy implementation or assets from a city-specific or differently
  licensed product.

Run `npm ci` and `npm test` before opening a pull request. The repository CI
also runs the public-boundary checks.
