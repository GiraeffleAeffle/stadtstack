# ADR 0006: Keep Mecky workers and administrative workspaces replaceable

- **Status:** accepted; ADR 0010 clarifies reference-surface and role identity
  ownership
- **Date:** 2026-08-05

## Context

The administration will need a useful work surface and role-specific Mecky
assistance, but OpenDesk, Buzz, Hermes, and OpenClaw are replaceable products
with different deployment and policy models. Binding the first flow to one of
them would make a workspace or agent runtime an accidental owner of civic
truth.

## Decision

Stadtstack exposes a narrow reviewed-contract and worker-task Interface. A
thin internal administration workbench is the first surface; OpenDesk, Buzz,
Hermes, OpenClaw, or a later tool may implement an Adapter behind that Seam.
Public, administration, and council Mecky contexts use separate identities,
visibility, and default-deny tools. No worker or workspace may directly
publish, approve, submit, vote, mutate civic state, or treat Nostr content as
administrative authority.

## Why

The deep Interface keeps coordination and review rules stable while allowing
the city's preferred workspace or worker runtime to change. Role separation
also makes a public explanation, an internal review, and a council rehearsal
independently testable.

## Consequences

The first browser proof uses a thin Stadtstack workbench and role-scoped
companion views. Selecting or integrating OpenDesk, Buzz, Hermes, or another
runtime is a later Adapter decision and cannot weaken the same contracts.
