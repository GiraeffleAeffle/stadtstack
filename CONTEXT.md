# Stadtstack civic coordination

Stadtstack is the municipality-neutral context for coordinating a civic case
from signed public discussion through reviewed, public-safe information. It
supports city companions without owning a city's source records, legal
authority, formal votes, or publication decisions.

## Discussion and case language

**Discussion**:
A signed public contribution about a shared civic concern. A discussion is
input and provenance, not a formal proposal or authority transition.
_Avoid_: proposal, decision, ballot

**Suggestion**:
A coordination artifact shaped from discussion so a city can review the
concern. A suggestion has no legal effect and does not advance a formal civic
stage by itself.
_Avoid_: motion, adopted measure, formal proposal

**Topic**:
A municipality-scoped public thread that can connect ordinary posts,
discussion, and arguments before a Civic Case exists. A Topic is navigation
and provenance, not a Case stage or authority state.
_Avoid_: case, proposal, docket

**Civic case**:
A bounded question or concern that is being coordinated, evidenced, reviewed,
and projected for a city community.
_Avoid_: source record, legal proceeding

**Department package**:
A scoped request, response, evidence, and review unit owned by one subject
area within a civic case.
_Avoid_: task ticket, public answer

**Administration work request**:
A deterministic, checksum-bound rendering of one Department package for a
replaceable municipal workspace. Preparing it performs no external write and
does not change the Civic Case.
_Avoid_: submitted task, official assignment, stage transition

**Workspace handoff receipt**:
An observation that one exact administration work request was acknowledged by
an external workspace and task reference. It is continuity evidence, not a
review attestation or civic authority.
_Avoid_: approval, accepted answer, official decision

**Administration response return**:
A checksum-bound response from the external task that separates public-safe
summary and citations from private evidence and workspace identifiers. It can
become only a Department draft until a different human reviewer attests it.
_Avoid_: published answer, reviewed response, Citizen Brief

**Citizen Brief readiness**:
An effect-free, checksum-bound assessment of whether all eight current
Department responses have independent accepted reviews. It may prepare an
exact steward command, but it does not append or publish the brief.
_Avoid_: automatic publication, eighth-response trigger, agent approval

**Reviewed citizen brief**:
A public-safe view of a civic case containing only reviewed, redacted
information and its provenance.
_Avoid_: raw dossier, publication decision

**Advisory participation**:
A non-binding expression of community preference summarized for deliberation;
it has no formal vote or authority effect.
_Avoid_: vote, ballot, referendum

**Council rehearsal**:
A read-only preparation view for council deliberation that does not submit,
approve, publish, or enact a civic decision.
_Avoid_: council decision, legislative action

## Record and review language

**Case event**:
An immutable, ordered statement that an accepted change or correction occurred
within one Civic case.
_Avoid_: database update, chat message, Nostr event

**Case journal**:
The complete ordered history of Case events from which the current state of a
Civic case can be reconstructed.
_Avoid_: activity log, relay history, mutable case row

**Review attestation**:
An accountable statement that a named reviewer accepted or rejected a bounded
artifact under a stated policy and version.
_Avoid_: approval button, agent confidence, inferred review

**Reviewed source admission**:
An accountable human decision that one exact public source capture may enter a
source-specific public knowledge projection under a named policy. Admission
preserves the source's authority and correction state; it does not verify every
claim or approve a generated answer.
_Avoid_: crawler result, AI review, official decision, answer approval

**Reviewed source projection**:
A checksum-bound, municipality- and source-specific public snapshot of admitted
local news or Ratsinformationssystem records prepared without publishing it.
_Avoid_: raw source archive, mixed-authority index, deployed endpoint

**Public exchange record**:
A signed, public-safe representation of a reviewed artifact that another
community or client may verify and consume without receiving private case data
or civic authority.
_Avoid_: database export, official decision, public Case journal

**Agent contribution**:
A machine-authored draft, explanation, or evidence aid whose agent identity,
scope, and inputs are attributable. It cannot serve as a human review
attestation or Authority transition.
_Avoid_: autonomous decision, municipal answer, anonymous content

## Relationships

A normal post may be promoted into a **Topic** discussion. A resident may
adopt and sign a **Topic suggestion candidate** without creating a Case. Only
an accountable **Human Case admission** creates the **Civic case** and admits
that exact candidate for review. Neither the signature nor the admission is a
formal proposal or an authority transition. A **Civic case** is understood
through its **Department packages**; packages that have been reviewed may
contribute to a **Reviewed citizen brief**. **Advisory participation** and **Council
rehearsal** can inform deliberation about that brief, but neither creates an
**Authority transition**. Formal submission, publication, or voting remains an
explicit act of the **Official source** and its city owner. Accepted changes
and corrections form the private **Case journal**. A reviewed artifact may be
represented as a **Public exchange record**, but that record does not reveal
the Case journal or transfer authority.

A Department package may be rendered as an **Administration work request**
for openDesk, OpenProject, or another Stage Tool. A **Workspace handoff
receipt** binds the external task without changing Case state. An
**Administration response return** becomes a private Department draft only
through the assigned Department role; an independent review attestation is
still required before its public-safe fields can enter the Reviewed citizen
brief. **Citizen Brief readiness** then exposes explicit blockers or prepares
one exact command for a human Case steward; the coordinator alone derives the
brief into the Case journal.

A **Citizen-signed suggestion candidate** becomes an **Admitted citizen
suggestion** only through an accountable human Case event. Its reviewed public
line first advances through a read-only **Case binding receipt** and is then
represented once as the **Public knowledge projection**. The **Case Steward**
credential remains outside every public client. Public Mecky and the
**Mitmachen view** consume that same version and checksum. A
**Reviewed public outcome** can close the public information loop back to the
signed Discussion, while any formal governance vote remains a separate
Authority transition.

A city-specific Adapter may capture a public article or council record, but a
**Reviewed source admission** is required before the exact capture can enter a
**Reviewed source projection**. Public Mecky can reuse that projection for
ordinary cited answers; the source review is not repeated for every answer and
never changes the Civic Case.

## Boundary and companion language

**Civic Federation Envelope**:
A versioned, reviewed exchange artifact that binds municipality scope, case
identity, provenance, review state, authority state, and publication
eligibility without granting authority to the recipient.
_Avoid_: database row, authority token

**Mecky context**:
A role-scoped companion identity and view for public, administration, or
council work. Each context sees only the information and capabilities allowed
for that role.
_Avoid_: shared chatbot, autonomous city agent

**Public Mecky answer**:
An attributable agent contribution produced only after an explicit request
and grounded in cited, current, reviewed public artifacts plus the attributed
signed discussion. Its facts, uncertainty, and concise reasoning are separate.
The reviewed artifacts—not every generated answer—carry human review.
_Avoid_: official municipal answer, uncited chatbot reply, review attestation

**Citizen-signed suggestion candidate**:
A Mecky-assisted suggestion that a resident adopted or edited and then signed
as an exact NIP-01 event. It awaits human Case admission and has not been
published, submitted, voted on, or accepted into the Case journal.
_Avoid_: automatic proposal, submitted motion, Case event

**Topic suggestion candidate**:
A citizen-signed suggestion whose source discussion, Mecky answer, and
municipality remain bound to a Topic while no Civic Case identifier exists.
The same candidate deterministically maps to one prospective Case identity,
but only a human steward may perform the admission.
_Avoid_: admitted suggestion, pre-created Case, autonomous intake

**Human Case admission**:
The accountable, idempotent steward transition that independently verifies a
Topic discussion, cited Mecky answer, and citizen signature before atomically
creating one Civic Case and admitting the candidate. It starts coordination,
not a formal municipal procedure.
_Avoid_: AI admission, proposal approval, automatic administration request

**Case Steward**:
A separately authenticated human role that may admit one exact, independently
verified Topic suggestion candidate through the Case coordinator. The role and
its credential never belong to the public Röbel client, public Mecky, or a
resident session, and admission grants no publication, administration,
governance, or treasury authority.
_Avoid_: public admin button, chatbot operator, municipal approver

**Case binding receipt**:
A public-safe, checksum-bound read-model projection showing that one exact
signed discussion and Topic suggestion candidate were admitted to one Civic
Case version. It is rebuilt from the private Case journal, carries no command
capability, and neither mutates the signed Nostr root nor becomes a second Case
source of truth.
_Avoid_: admission command, public Case journal, authority token

**Admitted citizen suggestion**:
A citizen-signed suggestion candidate whose exact signature, discussion,
municipality, Topic or Case provenance, and Mecky receipt bindings were
checked and then admitted
to the Case journal by an accountable human steward. Admission starts review;
it does not create a formal proposal, publication, or vote.
_Avoid_: approved proposal, automatic intake, adopted motion

**Public knowledge projection**:
The single versioned, checksum-bound public read model shared by public Mecky
and Mitmachen. It contains only the current signed discussion, admitted
suggestion, reviewed Citizen Brief, advisory aggregate, and reviewed outcome.
_Avoid_: public Case journal, chatbot memory, parallel content store

**Mitmachen view**:
A public rendering of the Public knowledge projection that shows the Citizen
Brief, provenance, participation window, advisory options and result, and the
reviewed outcome. It is not a ballot and exposes no formal vote operation.
_Avoid_: governance vote, referendum, legally binding poll

**Reviewed public outcome**:
An accountable, checksum-bound public Case projection of what followed the
reviewed Citizen Brief and advisory participation. It links back to the
original signed discussion and disappears when a bound source becomes stale.
_Avoid_: external publication receipt, council decision, enacted measure

**Signed discussion record**:
A public contribution with a verifiable author and provenance that can be
shared between communities. It is input to review, not the administration
record, vote ledger, or publication authority.
_Avoid_: civic source of truth, municipal database

**Official source**:
A city-owned record system that remains authoritative for its own records and
formal transitions.
_Avoid_: imported truth, federation record

**Authority transition**:
An explicit city-owned change such as formal submission, publication, or vote;
it is never inferred from discussion, suggestion, review, forecast, or
advisory participation.
_Avoid_: workflow stage, assistant action
