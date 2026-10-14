/**
 * Merkle tree hashing, inclusion proofs and consistency proofs as specified in RFC 9162 §2.1.
 * Proof generation follows the recursive definitions; verification follows the iterative
 * algorithms in §2.1.3.2 and §2.1.4.2.
 */
import { bytesEqual, sha256 } from "./hash.ts";

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

export function leafHash(data: Uint8Array): Uint8Array {
  return sha256(LEAF_PREFIX, data);
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(NODE_PREFIX, left, right);
}

function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k << 1 < n) k <<= 1;
  return k;
}

/** Merkle Tree Hash over already-computed leaf hashes. */
export function rootFromLeafHashes(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256();
  if (leaves.length === 1) return leaves[0]!;
  const k = largestPowerOfTwoBelow(leaves.length);
  return nodeHash(rootFromLeafHashes(leaves.slice(0, k)), rootFromLeafHashes(leaves.slice(k)));
}

export function merkleRoot(entries: readonly Uint8Array[]): Uint8Array {
  return rootFromLeafHashes(entries.map(leafHash));
}

export function inclusionProof(index: number, leaves: readonly Uint8Array[]): Uint8Array[] {
  if (index < 0 || index >= leaves.length) throw new RangeError("leaf index out of range");
  if (leaves.length === 1) return [];
  const k = largestPowerOfTwoBelow(leaves.length);
  return index < k
    ? [...inclusionProof(index, leaves.slice(0, k)), rootFromLeafHashes(leaves.slice(k))]
    : [...inclusionProof(index - k, leaves.slice(k)), rootFromLeafHashes(leaves.slice(0, k))];
}

export function consistencyProof(oldSize: number, leaves: readonly Uint8Array[]): Uint8Array[] {
  if (oldSize < 1 || oldSize > leaves.length) throw new RangeError("old size out of range");
  if (oldSize === leaves.length) return [];
  return subproof(oldSize, leaves, true);
}

function subproof(m: number, leaves: readonly Uint8Array[], complete: boolean): Uint8Array[] {
  const n = leaves.length;
  if (m === n) return complete ? [] : [rootFromLeafHashes(leaves)];
  const k = largestPowerOfTwoBelow(n);
  return m <= k
    ? [...subproof(m, leaves.slice(0, k), complete), rootFromLeafHashes(leaves.slice(k))]
    : [...subproof(m - k, leaves.slice(k), false), rootFromLeafHashes(leaves.slice(0, k))];
}

export function verifyInclusion(
  index: number,
  treeSize: number,
  leaf: Uint8Array,
  proof: readonly Uint8Array[],
  root: Uint8Array,
): boolean {
  if (index < 0 || index >= treeSize) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && bytesEqual(r, root);
}

export function verifyConsistency(
  oldSize: number,
  newSize: number,
  oldRoot: Uint8Array,
  newRoot: Uint8Array,
  proof: readonly Uint8Array[],
): boolean {
  if (oldSize < 1 || oldSize > newSize) return false;
  if (oldSize === newSize) return proof.length === 0 && bytesEqual(oldRoot, newRoot);
  if (proof.length === 0) return false;

  const path = (oldSize & (oldSize - 1)) === 0 ? [oldRoot, ...proof] : [...proof];
  let fn = oldSize - 1;
  let sn = newSize - 1;
  while (fn % 2 === 1) {
    fn >>= 1;
    sn >>= 1;
  }
  let fr = path[0]!;
  let sr = path[0]!;
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      sr = nodeHash(sr, c);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && bytesEqual(fr, oldRoot) && bytesEqual(sr, newRoot);
}
