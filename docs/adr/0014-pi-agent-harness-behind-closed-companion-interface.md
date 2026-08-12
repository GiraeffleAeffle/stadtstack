# ADR 0014: Embed Pi behind the closed companion worker interface

- **Status:** accepted
- **Date:** 2026-08-12

## Context

ADRs 0011–0013 define Public Mecky as an attributable companion that answers
an explicit question from the current reviewed Public knowledge projection.
The first Röbel watcher proved the Nostr transport and source boundary, but it
sent one hand-built Chat Completions request directly to the provider. That is
not a sufficient long-term agent runtime: provider streaming, cancellation,
turn lifecycle, context transformation, session events, retry behavior, and
future bounded tools would otherwise accrete inside the relay watcher.

Three mature open-source harnesses were considered:

- Pi exposes an embeddable agent core with a stateful loop, awaited lifecycle
  events, provider abstraction, tool preflight/postprocessing, cancellation,
  context transformation, and optional SQLite session storage. Its core is a
  library rather than a personal-assistant control plane.
- OpenClaw provides a broad Gateway, channels, skills, host integrations, and
  sandboxed or elevated tools. It remains suitable for a separately governed
  discovery or operator companion, but its Gateway and default capabilities
  are larger than Public Mecky needs.
- Hermes emphasizes persistent memory, self-created skills, learning across
  sessions, messaging gateways, and a large tool catalogue. Those defaults
  conflict with a public companion whose usable knowledge must disappear when
  its checksum-bound reviewed source becomes stale.

The existing Stadtstack `CompanionHarnessAdapter` is already the correct deep
seam. It accepts one prepared, immutable worker task and admits only a
validated worker result. The task contains role-scoped context, exact
citations and artifact checksums, identity, limits, and a default-deny effect
policy. It deliberately exposes no coordinator command, journal, signing key,
relay write, vote, or publication interface.

## Decision

Use the maintained, MIT-licensed `@earendil-works/pi-agent-core` and
`@earendil-works/pi-ai` packages, pinned at `0.84.1`, as the production Public
Mecky harness. This release requires Node `>=22.19.0`; the Public Mecky image
therefore uses a reviewed immutable Node 22 linux/amd64 base rather than the
earlier Node 20 base. Pi remains behind the existing
`CompanionHarnessAdapter` / `WorkerTaskV1 -> WorkerResultV1` interface. The
deterministic local harness remains the offline conformance implementation.
The older OpenClaw adapter remains replaceable test and discovery integration;
it is not the deployed Public Mecky runtime.

The ownership split is exact:

- Stadtstack prepares the role-scoped task and validates the result. It owns
  citation, artifact, projection, identity, limit, and authority checks.
- Pi owns the model turn lifecycle, streaming, cancellation, provider errors,
  context conversion, and auditable harness events.
- The Röbel watcher is only a Companion transport adapter. It owns Nostr
  subscription, explicit-mention detection, signed reply transport, relay
  retry, rate limiting, and idempotency reconstructed from public events.
- The model provider performs inference only. An OpenAI-compatible endpoint
  does not become a civic source, memory store, tool host, or authority owner.

For the first permanent release, every Pi invocation is a fresh bounded run
keyed by the exact discussion id, Case id, projection checksum, policy version,
and worker identity. The complete reviewed evidence snapshot is supplied in
the prepared task. Pi receives an empty tool list and may not load filesystem,
shell, browser, network-fetch, MCP, dynamic skill, self-modification, signing,
or civic command tools. Persistent free-form model memory is forbidden. A
later read-only reviewed-knowledge tool requires its own closed checksum-bound
Interface and ADR; it may never expose private Case state.

The adapter must additionally enforce:

- exact provider origin and model allowlists, with the API key supplied only
  at the private deployment boundary;
- temperature zero, bounded output, a hard external deadline that aborts the
  Pi run, and fail-closed handling of partial or malformed streams;
- one closed JSON answer shape with a concise answer and one to three evidence
  identifiers already present in the task;
- no raw chain-of-thought persistence or publication; only the concise public
  reasoning summary already admitted by the Stadtstack result contract;
- result validation after the harness returns, even if Pi reports success;
- no answer publication when discussion intake, reviewed evidence, provider,
  cancellation, citation binding, or result validation fails; and
- structured, value-free operational events sufficient to prove invocation,
  completion/refusal, duration, model id, task checksum, and cited artifact
  checksums without logging prompts, citizen content, credentials, or hidden
  reasoning.

Public Mecky does not require an administration review for each answer.
Accountable reviewers accept or correct the source artifacts and Public
knowledge projection. Mecky may then explain those current artifacts
autonomously with citations and uncertainty. A generated answer remains an
Agent contribution and can never substitute for a Review attestation,
Department response, admitted suggestion, institutional publication, or vote.

## Consequences

The public companion gains a mature, testable agent lifecycle without turning
the Röbel relay watcher into a bespoke agent framework or deploying a broad
personal-assistant Gateway. Provider replacement remains behind Pi's provider
adapter; civic policy remains outside the harness.

The initial zero-tool configuration is intentionally less capable than Pi,
Hermes, or OpenClaw can be. That is a boundary, not a temporary prompt. The
full civic flow still proceeds through explicit product actions: a resident
mentions Mecky, adopts and signs a suggestion, a steward admits it, named
administration actors review their packages, and Mitmachen renders the
reviewed Citizen Brief and advisory outcome.

Acceptance requires offline fake-stream tests, malformed/timeout/cancellation
tests, citation and source-staleness negatives, a real provider canary, a real
signed mention-to-cited-answer relay trace, restart/idempotency proof, and
browser QA of the resulting Röbel flow. This ADR authorizes architecture and
local implementation only; it does not itself authorize a provider call,
Secret materialization, relay publication, Talos mutation, suggestion
admission, administration action, or formal civic effect.
