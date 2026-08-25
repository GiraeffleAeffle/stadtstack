# ADR 0029: Gate any Röbel ballot on a Citizen credential bridge and compatibility decision

- **Status:** proposed
- **Date:** 2026-08-24

## Context

The Röbel Civic Journey needs an advisory participation step after a resident
turns a Topic into a signed proposal and the same Case has received reviewed
administration feedback and a Citizen Brief. That product need does not imply
that another registry, election suite, treasury, or wallet stack should be
deployed.

The existing chain inventory is the **Strausberg advisory-voting pilot** on
Gnosis chain ID 100, not Röbel or municipal infrastructure. It contains a
`StrausbergVotingVerifier` at
`0x84f6Ad0003493D605473e53AE1A0b98fC5a2C425`, a
`StrausbergElectionRegistry` at
`0x8ADBeF830f4351aE8a848510eAE487DA22D5FE4c`, and a Safe at
`0xf2130F19ceC85E380DA85Df8D3A0498FdfFDbFBF`. The only evidenced Safe
permissions are `DEFAULT_ADMIN_ROLE` and `ELECTION_OPERATOR_ROLE` on that
election registry. Those permissions confer neither Röbel nor municipal
authority.

`StrausbergElectionRegistry` is not a citizen registry. It records election
configuration, frozen Anchor commitments, nullifier use, and tally hashes.
Eligibility originates in a separate residency/eligibility system and a
correlation-sensitive off-chain commitment-enrolment store. An Anchor contains
cryptographic commitments, never Citizen identities, App Accounts, wallet or
Safe addresses, Nostr keys, social posts, or Case evidence.

The historical pilot election is expired and cannot be reopened. Its exact
identifier and state remain Operations evidence rather than a public
configuration input. The deployed verifier also still requires a real circuit
proof against its deployed bytecode before it can be treated as ready for a new
ballot.

Röbel currently authenticates residents through a Thirdweb client Adapter.
The provider-neutral `CitizenSession` seam and the passkey-owned Safe/Pimlico
coexistence scaffold do not yet provide the credential path required by the
existing ballot: a citizen session plus a passkey/WebAuthn signature over a
commitment enrolment. A successful Thirdweb login or signed Nostr post is
therefore necessary for the Civic Journey but insufficient to open a ballot.

The current proposal and Mitmachen surfaces have advisory legal effect. No
reviewed municipal mandate, appropriation, treasury execution policy, or
binding ballot authority exists for the staging journey.

## Decision

Do not deploy a duplicate citizen or voting stack for the first Röbel staging
tracer. First implement and prove a **Citizen credential bridge** behind
`CitizenSession`; then perform an explicit cross-municipality compatibility and
ownership decision before either reusing the Strausberg pilot contracts or
deploying a Röbel-owned equivalent.

The bridge binds one provider-neutral Citizen principal to the exact login
proof, Nostr public key, passkey/WebAuthn credential used to sign the commitment
enrolment, optional passkey-owned Safe, eligibility reference, issuance
version, and revocation/rotation state. Thirdweb, Nostr, passkey/Safe/Pimlico,
and the eligibility source remain replaceable Adapters. No provider subject,
wallet address, Safe address, Nostr key, or commitment becomes the canonical
Citizen identity by itself.

The bridge must prove uniqueness, replay rejection, duplicate-enrolment
rejection, credential rotation, withdrawal, lost-device recovery, and
Safe-owner changes. Recovery cannot transfer a commitment into an already
frozen Anchor or reclaim a ballot. It creates a new credential binding and
fresh commitment enrolment for a later election and Anchor.

After the complete Thirdweb-backed signup, signed-Nostr post, explicit
`@Mecky`, Discussion, proposal, Department feedback, and Citizen Brief tracer
passes, the ballot lane may be prepared only if all of these gates pass:

1. an owner explicitly approves whether Strausberg-labelled pilot
   infrastructure may host a Röbel exercise;
2. Gnosis chain, exact source revision, deployed code hashes, immutable
   verifier, election-registry roles, Safe ownership and Safe recovery are
   independently verified;
3. a real circuit proof is generated and accepted by the deployed verifier;
4. the exercise receives a fresh Röbel-namespaced `electionId`, immutable
   metadata hash, election-specific external nullifier, reviewed dates and
   exact operator transaction;
5. each Citizen has at most one active commitment in that election namespace,
   eligible commitments are frozen before the Anchor is built, and the Anchor
   contains only those commitments; and
6. the off-chain enrolment, canonical ballot log, and tally workspace use an
   isolated Röbel store with explicit access, retention, backup, incident and
   no-real-time-observation policies.

The result is a **formal cryptographic ballot with advisory legal effect**. Its
eligibility snapshot, nullifier, metadata, ballot-log, closing, and tally rules
are formal and auditable. Its legal effect is still advisory: it cannot enact a
council decision, submit an openDesk record, approve a municipal budget, sign a
treasury transaction, or move funds.

Once opened, an election cannot be erased or reopened. An invalid or aborted
exercise is closed with its auditable empty or actual tally and accompanied by
a public correction/invalidity notice. Any rerun uses a new `electionId`, new
external nullifier, new frozen Anchor, and new reviewed dates. The same Case
continuation line links both the invalidated exercise and its replacement; it
does not rewrite history.

A binding vote or treasury execution requires a separate ADR, named municipal
authority owner, legal basis, signer policy, and exact external-effect
authorization. Treasury visualisation may show reviewed budget context but
cannot construct or submit an executable Safe transaction.

## Consequences

Contract work no longer blocks signup and discussion, and the project avoids
creating two active eligibility or election systems before their ownership is
known. Authentication, Nostr provenance, WebAuthn control, eligibility,
commitments, ballot integrity, municipal authority, and treasury execution
remain distinct concepts.

Reusing the Strausberg pilot could avoid a duplicate verifier and election
registry, but only after proof-level compatibility and explicit ownership
approval. If that decision fails, a Röbel-owned deployment must retain the same
credential, Anchor, privacy, recovery, audit, and no-authority boundaries.

The public feed may show a correction-aware advisory result only after the
canonical ballot has closed and a reviewed public result artifact exists. It
must never expose the commitment-enrolment store, per-ballot log, real-time
participation telemetry, or correlation identifiers.

## Rejected alternatives

- **Deploy a fresh full contract stack now:** duplicates infrastructure before
  the Citizen credential and ownership contracts are known.
- **Treat `StrausbergElectionRegistry` as a citizen registry:** confuses ballot
  state with eligibility and identity.
- **Use the Thirdweb wallet or Safe address as Citizen identity:** couples civic
  eligibility and recovery to one provider or execution Adapter.
- **Use a Thirdweb login without WebAuthn commitment enrolment:** does not
  satisfy the existing Anchor eligibility path.
- **Reuse or reopen the expired election:** corrupts its immutable identifier,
  metadata, nullifier, dates, and audit trail.
- **Let an advisory result execute the treasury:** crosses into municipal
  financial authority without an owner or legal mandate.
- **Reuse a shared off-chain ballot store across cities:** creates avoidable
  correlation, retention, access, and incident risk.
- **Put raw social, Case, or Meld/Kair evidence on chain:** violates data
  minimisation and the accepted public/private projection boundaries.

## Acceptance conditions

This decision can move to `accepted` when:

1. the complete Thirdweb-backed staging tracer passes in a fresh browser;
2. the Thirdweb-to-passkey credential bridge or an explicitly reviewed
   equivalent passes end-to-end commitment-enrolment tests without a privileged
   browser secret;
3. uniqueness, replay, rotation, revocation, withdrawal, recovery, and
   post-freeze non-transfer tests pass;
4. the cross-municipality compatibility report binds the exact chain, source,
   deployed code hashes, verifier, registry, roles, Safe ownership/recovery and
   named owner decision;
5. a real proof is accepted by the deployed verifier before an election opens;
6. one fresh namespaced election is prepared from immutable metadata, an
   election-specific external nullifier, and a frozen eligible-commitment
   Anchor;
7. the isolated off-chain stores pass access, retention, backup, recovery,
   incident, privacy, and no-real-time-observation checks;
8. the UI and public change feed label the formal result legally advisory and
   expose no treasury or council-execution capability; and
9. abort, close, correction, invalidity and rerun drills preserve the immutable
   ballot history and the same Case continuation line.

