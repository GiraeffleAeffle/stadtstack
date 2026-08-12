# ADR 0015: Isolated Röbel E2E sandbox and explicit production promotion

- Status: Accepted
- Date: 2026-08-12
- Supersedes: none
- Extends: ADR 0003, ADR 0009, ADR 0011, ADR 0012, ADR 0013, ADR 0014

## Context

The permanent Röbel release cannot be validated responsibly by writing test
discussions, synthetic identities, or experimental agent answers into the
production relay or production application. The complete civic path still has
to be exercised in the actual Talos environment: signed discussion, Public
Mecky answer, citizen-signed suggestion, human admission, administration
packages, Citizen Brief, advisory participation, council dry-run, and the
reviewed outcome backlink.

The test must also prove the difficult seams that a unit fixture cannot prove:
WebSocket relay policy, the Pi 0.84.1 companion harness, container networking,
durable restart and replay, role-scoped browser views, and exact deletion.

## Decision

Create one disposable, synthetic-only Talos environment named
`stadtstack-roebel-e2e`. It is a separate product surface, not a mode of the
production deployment.

### Two relay authorities

The environment contains two independent NIP-01 stores:

1. `citizen-relay` accepts only the explicit synthetic Citizen and human test
   persona public keys. The Röbel test client writes signed discussion and
   citizen-signed suggestion events here.
2. `agent-relay` accepts only the explicit Public Mecky service public key.
   Public Mecky restores its own reply history and publishes replies here.

Public Mecky reads mentions from the Citizen relay and writes only to the Agent
relay. The browser reads citizen-authored material from the first and Mecky
replies from the second. The relay split is an authority boundary: the agent
cannot impersonate a Citizen, and synthetic Citizens cannot publish agent
answers.

Both stores use namespace-owned disposable persistence. They have no
federation, production fallback, public relay target, paid-provider fallback,
or shared storage.

### Synthetic personas and closed workflow

The sandbox provisions deterministic synthetic identities for these roles:

- Citizen, who starts a discussion, explicitly mentions Public Mecky, edits a
  proposed suggestion, and signs it;
- Case steward, who admits or refuses that exact signed suggestion;
- Administration, which drafts and reviews the eight department packages;
- Council, which performs only the explicitly advisory dry-run;
- Public Mecky, which answers from checksum-bound reviewed public evidence.

These identities have no production credentials, CitizenNFT, voting power,
office, or municipal authority. Every UI surface says that the environment is
synthetic and non-authoritative.

The scenario is complete only when one Case proves, in order:

1. signed public discussion;
2. cited Mecky answer from reviewed evidence;
3. citizen-edited and citizen-signed suggestion candidate;
4. human steward admission;
5. eight assigned, drafted, and reviewed administration packages;
6. reviewed Citizen Brief visible to Public Mecky and the public view;
7. advisory participation visible in the Röbel `Mitmachen` surface;
8. council dry-run with no binding vote or municipal effect;
9. reviewed outcome backlink visible from the original discussion.

### Runtime and restart boundary

The Stadtstack coordinator retains the append-only journal contract from ADR
0008. Its sandbox journal is owned by this namespace and mounted at the exact
runtime path. The test records a truthful first-run receipt, restarts the
control-plane container while retaining the owned journal, records the
recovered receipt, and proves equal Case head, projection checksums, event and
idempotency counts, and zero duplicate events.

Pod replacement durability is not inferred from a same-Pod container restart.
If the permanent release requires Pod replacement durability, ADR 0013's
single-writer persistent storage and restore gate still apply.

### Browser proof

Browser QA uses only the sandbox host and verifies:

- the Citizen can create and sign the scenario;
- Mecky answers appear under its distinct machine identity and cite reviewed
  material;
- public, Administration, and Council projections expose only their allowed
  fields;
- Citizen Brief, advisory `Mitmachen`, council dry-run, and outcome backlink
  remain continuous with the same Case head;
- no production endpoint, relay, account, secret, or mutable production object
  appears in network traffic or rendered content;
- responsive layout, keyboard navigation, accessible names, and visible focus.

### Ownership, effects, and exact deletion

The release owns exactly one namespace and the explicitly reviewed images
loaded for it. It creates no Ingress or public DNS unless a separately reviewed
sandbox hostname is named in the release contract. It never edits existing
Röbel preview, workflow, data, registry, ingress, or production resources.

Rollback deletes the exact namespace, waits for its absence, removes only the
exact sandbox image digests from all three Talos CRI stores, and compares the
outside-resource inventory with the preflight digest. A mismatch fails closed.

### Production promotion

Passing the sandbox does not copy its data or identities into production and
does not authorize a rollout. Promotion is a separately reviewed configuration
change that:

- points citizen input to the production Röbel relay;
- keeps agent output on a separately owned production Agent relay;
- removes all synthetic keys, fixtures, and reset paths;
- uses permanent Stadtstack storage and reviewed backup/restore;
- preserves the same closed Pi companion interface and evidence policy;
- enables the production UI only behind an explicit feature flag;
- repeats read-only browser, privacy, role, and continuity checks before the
  flag is enabled.

## Consequences

The E2E proof becomes representative without contaminating production. The two
relay design adds one explicit client configuration seam and two small stores,
but makes author authority inspectable. The sandbox can be rerun from a clean
namespace and deleted without capturing existing infrastructure.

Public Mecky remains autonomous for ordinary cited answers. Administration
reviews the source material and civic artifacts at workflow gates; it does not
approve each generated answer. Mecky must refuse when reviewed evidence is
missing, citations cannot be produced, or the provider attempts tools or a
write outside its closed reply interface.

## Rejected alternatives

- **Use the production Röbel relay for test users.** Rejected because test
  identities and experimental answers would enter a production publication
  boundary.
- **Let Mecky write back to the Citizen relay.** Rejected because a single
  allowlist would blur citizen and machine authorship.
- **Mock the relay and browser path.** Rejected because it cannot prove ingress,
  WebSocket, persistence, restart, image, or role-isolation behavior.
- **Promote the sandbox namespace in place.** Rejected because synthetic
  identity, storage, reset, and deletion contracts must never survive into the
  permanent release.

This ADR records architecture only. It does not authorize cluster mutation,
external inference, public publication, or civic effect.
