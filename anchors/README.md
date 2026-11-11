# Published checkpoints

Each `checkpoint-NNNNNN.note` is a copy of a Merkle checkpoint signed by the live HandOff ledger
(Ed25519 and ML-DSA-65), in the plain-text note format of `packages/trust`: origin, tree size, root
hash, issue time. `NNNNNN` is the number of receipts the checkpoint covers.

**Why they are here.** A ledger kept only in its own database can be rewritten by whoever runs the
database. These copies sit in a public git history the database owner does not control alone, so a
rewrite shows up as a mismatch.

**Check it yourself**

```bash
curl -o ledger.json https://agent-two-hand-handoff.onrender.com/api/ledger
pnpm verify ledger.json --anchors anchors
```

This verifies every signature and hash link, and fails if the ledger disagrees with, or is missing, any
checkpoint published here.

**How they get here.** The scheduled workflow `.github/workflows/anchor.yml` runs
`pnpm anchors:publish` every six hours. It first verifies the live ledger against everything already
published, then adds notes for new checkpoints. Notes are append-only, and the job fails if the ledger
has diverged from them.

**What this does and does not prove.** It shows the ledger has not been rewritten since a checkpoint
was published, as far as git history can be trusted. Commit timestamps are set by the committer, so
this is not a trusted timestamp (an RFC 3161 timestamp would add one). If the demo database is ever
reset, earlier notes will no longer match the new ledger, which the check reports as a mismatch.
