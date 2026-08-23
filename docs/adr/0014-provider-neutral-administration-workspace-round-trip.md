# ADR 0014: Keep the administration workspace round trip provider-neutral and human-reviewed

- **Status:** accepted
- **Date:** 2026-08-22

## Context

ADR 0013 now permits an accountable human steward to create one Civic Case
from an exact citizen-signed Topic suggestion. The next visible journey step
is administration feedback: a department must receive a bounded question,
work in its normal environment, return a response, and let that response feed
the Citizen Brief.

Röbel may use openDesk, OpenProject, an existing municipal workspace, or a
later product. None of those systems should become the owner of the Civic
Case, the public answer, or the Case stage. An external task identifier also
must not be mistaken for administrative review or publication authority.

## Decision

Add a provider-neutral `administration-workspace-adapter` around the existing
`CivicCaseCoordinator` commands.

The round trip has five explicit records or transitions:

1. A current administration projection produces one deterministic
   `administration_work_request_v1` for one checksum-bound Department package.
   The request is `prepared_not_sent` and declares no network, credential,
   external-write, Case, publication, voting, or treasury effect.
2. A separately authorized connector may create a task in openDesk,
   OpenProject, or another municipal workspace. That connector is outside this
   public Module.
3. An administration actor may record an exact
   `administration_workspace_handoff_receipt_v1` after observing the external
   workspace and task references. The receipt records acknowledgement only;
   all civic effects remain false.
4. A returned `administration_workspace_response_v1` must bind the request,
   handoff receipt, Case, Department package, external task, target system, and
   its own checksum. Public-safe summary and citations remain separate from
   private evidence references and workspace identifiers.
5. Only the Department package's assigned `department_agent` may turn that
   exact response into `record_department_draft_v1`. This is still a private
   draft. A different registered `department_reviewer` must use the existing
   `attest_department_review_v1` command before public-safe fields become
   eligible for a Citizen Brief.

The request ID and idempotency key derive from the exact Case, package
checksum, and target. The handoff receipt and response each carry their own
canonical checksum. Replays are byte-stable; stale package, request, receipt,
task, target, actor, or checksum bindings fail closed.

The public reference implementation prepares and verifies contracts only. It
does not call a connector, discover an endpoint, use credentials, or write to
an external workspace. A live openDesk Adapter therefore needs a separate
operations decision that binds the exact endpoint, credential owner,
idempotent create/read operations, retention policy, rollback or reconciliation
behavior, and non-secret receipts.

The coordinator accepts returned public citations as exact, stored HTTPS
references only when they are public-shaped and contain no user information,
port, fragment, local/test hostname, or credential marker. This reconciles the
workspace return contract with the Case journal without adding an HTTP fetch,
DNS lookup, or any other network capability. Private evidence references stay
synthetic in the local reference.

## Consequences

The user journey can remain one line—Discussion, Topic, human Case admission,
Department work, reviewed Citizen Brief, advisory Mitmachen, and reviewed
outcome—while the records and owners behind each step remain separate.
openDesk and OpenProject are Stage Tools, not parallel civic systems.

Workspace acknowledgements and returned drafts stay private. External task
references, private evidence, credentials, and source-system record references
never enter the public Case projection. The Adapter cannot attest a review,
derive or publish a Citizen Brief, start participation, submit to council,
create a formal vote, or move treasury funds.

The current implementation proves deterministic preparation, acknowledgement,
return binding, assigned-role draft preparation, stale-binding rejection, and
zero civic effects offline. Live connector deployment and the Röbel UI for the
administration handoff remain separate implementation slices.
