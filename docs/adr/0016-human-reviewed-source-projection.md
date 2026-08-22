# ADR 0016: Prepare source-specific public knowledge only after human review

- **Status:** accepted
- **Date:** 2026-08-22

## Context

Public Mecky should answer ordinary tagged Röbel conversations from reviewed local reporting and Ratsinformationssystem material without requiring the administration to approve every answer. Direct retrieval from a newspaper, RSS feed, ALLRIS page or council calendar during inference would bypass source admission and make corrections unreliable. Treating a reviewed article as an official fact, or a council paper as a later decision, would also erase the source-authority boundary.

Röbel ADR 0017 defines a closed, checksum-bound consumer projection. Stadtstack needs the corresponding producer boundary: one accountable human decision over an exact captured source version, followed by an effect-free preparation step that cannot publish or mutate a Civic Case.

## Decision

Add `prepareReviewedPublicKnowledgeProjection` as a pure producer Module for exactly two source kinds: `local_news` and `ratsinformation`.

Each admitted record binds:

- one municipality and source kind;
- an exact source-capture SHA-256, reused as the public evidence identifier;
- a canonical publication and review time;
- the source-specific authority (`editorial_report` or `official_record`);
- an explicit correction lifecycle; and
- a checksum-bound attestation from an actor of class `source_reviewer` under one policy version.

The Module rejects agent review, pending admission, checksum drift, cross-source or cross-municipality data, future review, duplicate source identity, unknown fields, accessors, proxies and credential-bearing or non-HTTPS public URLs. It sorts admitted records deterministically and produces the exact `reviewed_public_knowledge_projection_v1` envelope consumed by Röbel.

Preparation returns a separate receipt with `status: prepared_not_published`, `authorityBinding: none` and every external, civic, administration, voting and treasury effect false. Reviewer identity and the source-review attestation remain preparation inputs; only evidence, authority, lifecycle and public review time enter the public projection.

## Consequences

A human reviews a source version once; Public Mecky may then answer multiple ordinary questions automatically with citations and no civic authority. Withdrawing, superseding or correcting a record changes the prepared projection before retrieval rather than requiring sentence-by-sentence answer approval.

This ADR does not deploy an HTTP endpoint, collect a source, create a real review corpus or authorize publication. A city-specific private Adapter still owns capture and reviewer authentication. A later public transport must serve the exact prepared bytes at the source-specific GET paths and retain correction evidence.
