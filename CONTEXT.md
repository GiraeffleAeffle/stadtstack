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

**Civic case**:
A bounded question or concern that is being coordinated, evidenced, reviewed,
and projected for a city community.
_Avoid_: source record, legal proceeding

**Department package**:
A scoped request, response, evidence, and review unit owned by one subject
area within a civic case.
_Avoid_: task ticket, public answer

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

A **Discussion** may be shaped into a **Suggestion**. A **Suggestion** may
organize a **Civic case** for review, but it is not a formal proposal or an
authority transition. A **Civic case** is understood through its
**Department packages**; packages that have been reviewed may contribute to a
**Reviewed citizen brief**. **Advisory participation** and **Council
rehearsal** can inform deliberation about that brief, but neither creates an
**Authority transition**. Formal submission, publication, or voting remains an
explicit act of the **Official source** and its city owner. Accepted changes
and corrections form the private **Case journal**. A reviewed artifact may be
represented as a **Public exchange record**, but that record does not reveal
the Case journal or transfer authority.

A **Citizen-signed suggestion candidate** becomes an **Admitted citizen
suggestion** only through an accountable human Case event. Its reviewed public
line is represented once as the **Public knowledge projection**. Public Mecky
and the **Mitmachen view** consume that same version and checksum. A
**Reviewed public outcome** can close the public information loop back to the
signed Discussion, while any formal governance vote remains a separate
Authority transition.

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

**Admitted citizen suggestion**:
A citizen-signed suggestion candidate whose exact signature, discussion,
municipality, Case, and Mecky receipt bindings were checked and then admitted
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
