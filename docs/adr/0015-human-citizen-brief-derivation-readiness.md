# ADR 0015: Prepare one human Citizen Brief derivation from reviewed Department responses

- **Status:** accepted
- **Date:** 2026-08-22

## Context

ADR 0014 separates an administration workspace return from the independent
Department review that can make its public-safe fields eligible for a Citizen
Brief. The remaining seam must answer two different questions without
conflating them:

1. Is the current Civic Case ready for a new Citizen Brief?
2. Who may turn that readiness into a Case event?

Automatically deriving a brief when the eighth review arrives would hide an
authority transition inside an Adapter callback. Rebuilding the summaries in
Röbel, Mecky, or a Mini App would create parallel public truth and checksum
drift.

## Decision

Add a `citizen-brief-readiness-adapter` over the current administration
projection.

The Adapter requires the human-admitted suggestion and exactly eight unique,
configured Department identifiers. It emits one deterministic
`citizen_brief_readiness_v1` with:

- the exact Case version, journal head, projection checksum, and policy;
- accepted Department identifiers and explicit missing, pending, rejected,
  corrected, or retracted blockers;
- only the package, draft, and independent review checksums needed by the
  coordinator; and
- no private evidence, workspace identifiers, assigned actor identifiers, or
  publication capability.

Readiness has three states: `waiting_for_department_review`,
`ready_for_case_steward`, and `citizen_brief_current`. Assessing readiness is
effect-free.

Only a registered `case_steward` may prepare the exact
`derive_citizen_brief_v1` command. Preparation binds the current Case version,
readiness checksum, brief identifier, steward identity, source bindings, and
idempotency key. It is `prepared_not_applied`; the coordinator remains the
only owner of the actual append. A current brief cannot be prepared again.

When the command is applied, the coordinator—not Röbel, Mecky, openDesk, or
the Adapter—derives the public summaries and citations from the accepted
Department responses. The resulting public Case projection remains the one
input to the Public knowledge projection shared by public Mecky and
Mitmachen.

## Consequences

The Röbel Civic Journey can show honest progress such as “five of eight
Departments reviewed” and can place one human steward action at the exact
boundary where a brief becomes a Case event. An external workspace return or
an agent cannot silently publish the eighth response.

Corrections and retractions make readiness blocked or make the prior brief
non-current through the existing coordinator checks. A fresh derivation must
bind the new exact checksums.

This Adapter does not call a workspace, mutate the Case, publish a brief,
start participation, create a formal proposal or vote, submit to council, or
move treasury funds. Röbel UI integration and a live openDesk connector remain
separate slices.
