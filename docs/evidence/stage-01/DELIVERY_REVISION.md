# Delivery revision contract

Each command record has two immutable revision identities:

- `source_baseline_sha` is the product baseline whose source the command was
  intended to assess.
- `execution_revision` is the checked-out Git revision when the command ran.

They are deliberately separate. Evidence generated while Stage 01 changes are
uncommitted identifies the source baseline and the prior checked-out revision;
it does not falsely claim to run at a future delivery commit.

## Non-recursive delivery attestation

A commit cannot truthfully embed its own final object ID. Delivery therefore
uses a two-commit chain:

1. The payload commit contains the corrected evidence and records.
2. The immediately following attestation-carrier commit contains
   `records/delivery-attestation.json`, whose command was run at the payload
   commit and whose output prints that payload SHA.

At final review, verify that the checkout's `HEAD^` equals the SHA printed in
the attestation artifact. This binds the attestation carrier (the delivered
review commit) to a concrete, immutable payload without a recursive self-SHA
claim. The owner/reviewer fields of the attestation record are the sign-off
metadata; no cryptographic signature is claimed.

## Current attestation

- Payload commit: `ab4c69da04ef36cb955566bbf68894441012ec61`.
- Attestation record: `records/delivery-attestation.json`.
- Carrier verification: at the final review checkout, `git rev-parse HEAD^`
  must equal the payload commit above and the attestation stdout must print the
  same SHA.
