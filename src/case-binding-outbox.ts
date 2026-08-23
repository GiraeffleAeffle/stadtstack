import type { PublicCaseBindingReceiptV1 } from "./case-binding-projection.ts";

/**
 * One immutable public receipt plus its opaque, monotonically increasing
 * delivery cursor. The cursor is not a row count and may contain gaps.
 */
export type CaseBindingOutboxEntryV1 = Readonly<{
  sequence: number;
  receipt: PublicCaseBindingReceiptV1;
}>;

export type CaseBindingOutboxReplayInput = Readonly<{
  afterSequence?: number;
  limit?: number;
}>;

/**
 * Minimal credential-free delivery port. Durable in-process adapters may
 * return a page synchronously; network adapters return the same page through
 * a Promise. Consumers must treat both forms identically.
 */
export type CredentialFreeCaseBindingOutboxReader = Readonly<{
  replay(
    input?: CaseBindingOutboxReplayInput,
  ): readonly CaseBindingOutboxEntryV1[] | Promise<readonly CaseBindingOutboxEntryV1[]>;
}>;

/** Precise in-process form used by the single SQLite owner. */
export type SynchronousCredentialFreeCaseBindingOutboxReader = Readonly<{
  replay(input?: CaseBindingOutboxReplayInput): readonly CaseBindingOutboxEntryV1[];
}>;
