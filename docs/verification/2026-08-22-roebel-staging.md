# Röbel staging execution snapshot — 2026-08-22

This is a dated integration receipt, not a municipal-readiness or authority
claim. It separates implemented public contracts, reviewed desired state, and
browser evidence that still has to be produced by a real staging tester.

## Current source boundaries

| Boundary | Exact current fact | Remaining acceptance |
| --- | --- | --- |
| Stadtstack contracts | Public `main` is `07b1c38f072ba3a99c3df492504a3468780b9731`. ADRs 0011–0017 cover cited Public Mecky, citizen signing, human Case admission, administration round trip, Citizen Brief readiness, and reviewed news/Ratsinformationssystem projections. Issues #1–#24 are closed; deployment issue #25 remains open. | The contracts still need one deployed, attributable browser journey rather than another synthetic reference flow. |
| Röbel product | Röbel-App PR #45 was merged from exact head `ab140015ec24187eb3b12539ca243bb11aa3a381` as protected-main commit `864b7421a72d871c495df818960cce64f54249e1`. Its verified Web job passed in 6m18s with runtime-only packaging and no retained Web build cache. | The roughly six-minute free-runner floor is accepted for the first tracer. A public/operator build split or protected larger builder is later performance work, not a reason to delay browser acceptance. |
| Last complete functional Release Set | Source `ef50ec8bf9ec1962a81b753d200b0fcd2a0bf616` produced Web digest `sha256:7d53a47604dd6ebd88e0cacfb7a9dfa73940a91641d0a79307a855146185c352`, Public Mecky digest `sha256:8e9d9746f6ac7bf8db791682cca6c63ca2950586e04f5bbf3f54abe75f66b08f`, and Release Set `sha256:e498a7a8064bc62cad9e6be64bdbd6db77c7c121069ba0433ae61ae304173adf`. | Activate this already verified functional set before advancing to a later CI-only source revision. |
| GitOps desired state | Protected operations `main` is `199aa1763cb07d733baf717e65a80234a1551cd6`. PR #6 at exact head `db60a0e8c6e823833aba51a49a9bc5e6a1482441` is the pending policy migration that adds one internal-only Public Mecky Service, one exact ingress NetworkPolicy, and the Web-to-Mecky URL while promoting the functional Release Set. | The exact bootstrap needs one bounded administrator-enforcement exception with unconditional restoration. Flux remains the only cluster applier. |
| Thirdweb staging | The guarded runtime rotation verified ConfigMap UID `22af4463-7c83-412e-b933-baaecd6ed685`, public-ID SHA-256 `e5e82087d50ca40a50373a4e2c182489ab832ac06b2eeeeeb04a4fe3a7d16988`, three Ready Web replicas, HTTP 200, and the injected ID in two of 50 served JavaScript assets. Browser verification then rendered the Thirdweb Connect Wallet dialog and reached the Google provider bootstrap with zero `KEY_NOT_FOUND` errors. No Thirdweb server secret was deployed or committed to public state. | One person must complete signup, publish a signed ordinary post, and exercise the civic tracer. |
| Provider-neutral identity | Röbel has a `CitizenSession` seam, a structural Safe adapter, dual-control proof envelopes, an atomic challenge interface, and a no-effect three-proof verifier. | There is no deployed WebAuthn ceremony, Safe creation/recovery, Pimlico execution, durable member/credential link, or coexistence E2E. This follows the complete Thirdweb-backed tracer. |

## First whole-flow acceptance

The test starts in the normal mixed Röbel feed. Ordinary posts stay ordinary.
One signed post is explicitly promoted into one canonical Topic and Discussion;
one pro and one contra Argument are rendered equivalently in the tree and
sunburst. An explicit `@Mecky` invocation must receive a same-thread answer
whose factual claims cite admitted public evidence and whose uncertainty and
no-authority boundary remain visible.

The resident then signs the exact Suggestion. A separate human steward admits
the Civic Case. One checksum-bound administration workspace package returns as
a draft, receives independent review, and makes the Citizen Brief ready. That
same Case and brief appear in advisory Mitmachen with finance context. No step
implicitly creates a Formal Ballot, municipal decision, publication, payment,
or treasury transfer.

## Ordered remaining gates

1. Merge operations PR #6 only at its exact reviewed head, restore branch
   protection even on failure, and observe Flux reconcile exactly four owned
   objects.
2. Verify Web and Public Mecky readiness, internal-only reachability, immutable
   source/digests, and rollback to the previous reviewed Release Set.
3. Replace the synthetic timeline flood with one versioned coherent staging
   seed: mostly ordinary posts, one consolidated Marienfelder Straße Topic,
   one meeting-place/bar Topic, and one reviewed Bürgerausschuss or
   participation-budget Topic. Preserve signed history; rotate only explicitly
   disposable staging data.
4. Run the complete Thirdweb-backed browser journey and attach semantic,
   network, citation, signature, Case, review, Mitmachen, and rollback evidence
   to Stadtstack issue #25.
5. Only then implement the opt-in passkey-owned Safe/Pimlico coexistence path.

## Authority boundary

This snapshot authorizes no cluster mutation, credential publication, public
Nostr write, city publication, formal vote, governance decision, or treasury
effect. Mecky may answer from reviewed public evidence, but it cannot sign for
a resident, admit a Case, speak for the administration, vote, or move funds.
