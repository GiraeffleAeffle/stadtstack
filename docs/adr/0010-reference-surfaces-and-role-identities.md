# ADR 0010: Keep reference surfaces and agent identities scoped

- **Status:** accepted
- **Date:** 2026-08-08

## Context

The coordinator needs a visible conformance path for public, administration,
and council roles. Those surfaces must not become a second workflow
Implementation or silently turn an agent identity into human authority.

## Decision

Stadtstack may provide minimal public, administration, and council reference
surfaces for tests and demonstrations. They project the same coordinator
contract and never own case truth, review, publication, formal voting, or
source-system writes. Real community UX and administration workspaces are
replaceable Adapters outside this Module.

Each Mecky context has a distinct role, identity, session, projection, and
default-deny tool policy. A Nostr agent identity is attributable public
provenance; it is not an employee login, council attestation, or human
authority credential.

## Consequences

OpenClaw, Hermes, Buzz-like workers, and other harnesses can be swapped behind
`worker_task_v1`. Tests can prove context isolation without granting any tool
or civic effect. A later city integration must name its own owner and gate.
