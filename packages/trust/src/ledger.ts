import { verifyChain, type ChainReport } from "./chain.ts";
import {
  checkpointNote,
  rootOfReceipts,
  verifyCheckpointSignatures,
  type Checkpoint,
} from "./checkpoint.ts";
import { toBase64 } from "./hash.ts";
import { Keyring, type PublicKeyRecord } from "./keys.ts";
import type { Receipt } from "./receipt.ts";

export const LEDGER_FORMAT = "a2h-ledger-v1";

/** Portable export: everything a third party needs to verify the ledger offline. */
export interface LedgerFile {
  format: typeof LEDGER_FORMAT;
  keys: PublicKeyRecord[];
  receipts: Receipt[];
  checkpoints: Checkpoint[];
}

export interface CheckpointCheck {
  treeSize: number;
  issuedAt: string;
  signaturesOk: boolean;
  rootMatches: boolean;
  anchored: "matches" | "differs" | "not-provided";
  problems: string[];
}

export interface LedgerReport {
  ok: boolean;
  chain: ChainReport;
  checkpoints: CheckpointCheck[];
}

/**
 * Verifies the receipt chain, then every checkpoint against the receipts as they are stored now.
 * `anchoredNotes` are copies of checkpoint notes published outside the database (git, RFC 3161);
 * when given, each must match the checkpoint of the same size byte for byte.
 */
export function verifyLedger(ledger: LedgerFile, anchoredNotes: readonly string[] = []): LedgerReport {
  if (ledger.format !== LEDGER_FORMAT) throw new Error(`unsupported ledger format ${String(ledger.format)}`);
  const keyring = new Keyring(ledger.keys);
  const chain = verifyChain(ledger.receipts, keyring);

  const anchoredBySize = new Map<number, string>();
  for (const note of anchoredNotes) {
    const size = Number(note.split("\n")[1]);
    if (Number.isSafeInteger(size)) anchoredBySize.set(size, note);
  }

  const checkpoints = ledger.checkpoints.map((cp): CheckpointCheck => {
    const problems: string[] = [];
    const sig = verifyCheckpointSignatures(cp, keyring);
    problems.push(...sig.problems);

    let rootMatches = false;
    if (cp.treeSize > chain.hashes.length) {
      problems.push(`checkpoint covers ${cp.treeSize} receipts but only ${chain.hashes.length} exist`);
    } else {
      rootMatches = toBase64(rootOfReceipts(chain.hashes.slice(0, cp.treeSize))) === cp.root;
      if (!rootMatches) problems.push("root differs from the receipts stored now");
    }

    const anchoredNote = anchoredBySize.get(cp.treeSize);
    let anchored: CheckpointCheck["anchored"] = "not-provided";
    if (anchoredNote !== undefined) {
      anchored = anchoredNote === checkpointNote(cp) ? "matches" : "differs";
      if (anchored === "differs") problems.push("checkpoint differs from its anchored copy");
    }

    return { treeSize: cp.treeSize, issuedAt: cp.issuedAt, signaturesOk: sig.ok, rootMatches, anchored, problems };
  });

  for (const [size] of anchoredBySize) {
    if (!ledger.checkpoints.some((cp) => cp.treeSize === size)) {
      checkpoints.push({
        treeSize: size,
        issuedAt: "",
        signaturesOk: false,
        rootMatches: false,
        anchored: "differs",
        problems: [`an anchored checkpoint of size ${size} is missing from the ledger`],
      });
    }
  }

  const ok = chain.ok && checkpoints.every((c) => c.problems.length === 0);
  return { ok, chain, checkpoints };
}
