import { describe, expect, it } from "vitest";
import { sha256, toHex, utf8 } from "../src/hash.ts";
import {
  consistencyProof,
  inclusionProof,
  leafHash,
  merkleRoot,
  nodeHash,
  rootFromLeafHashes,
  verifyConsistency,
  verifyInclusion,
} from "../src/merkle.ts";

const leavesOf = (n: number) => Array.from({ length: n }, (_, i) => leafHash(utf8(`entry-${i}`)));

describe("Merkle tree (RFC 9162)", () => {
  it("hashes the empty tree as SHA-256 of nothing", () => {
    expect(toHex(merkleRoot([]))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("uses domain-separated leaf and node hashes", () => {
    const a = leafHash(utf8("a"));
    const b = leafHash(utf8("b"));
    expect(rootFromLeafHashes([a, b])).toEqual(nodeHash(a, b));
    expect(a).not.toEqual(sha256(utf8("a")));
  });

  it("verifies every inclusion proof for trees of size 1 to 33", () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = leavesOf(n);
      const root = rootFromLeafHashes(leaves);
      for (let i = 0; i < n; i++) {
        const proof = inclusionProof(i, leaves);
        expect(verifyInclusion(i, n, leaves[i]!, proof, root), `n=${n} i=${i}`).toBe(true);
      }
    }
  });

  it("rejects inclusion proofs for the wrong leaf, index or root", () => {
    const leaves = leavesOf(13);
    const root = rootFromLeafHashes(leaves);
    const proof = inclusionProof(5, leaves);
    expect(verifyInclusion(5, 13, leaves[6]!, proof, root)).toBe(false);
    expect(verifyInclusion(6, 13, leaves[5]!, proof, root)).toBe(false);
    expect(verifyInclusion(5, 13, leaves[5]!, proof, rootFromLeafHashes(leaves.slice(0, 12)))).toBe(false);
    expect(verifyInclusion(13, 13, leaves[5]!, proof, root)).toBe(false);
  });

  it("verifies every consistency proof for trees of size 1 to 33", () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = leavesOf(n);
      const newRoot = rootFromLeafHashes(leaves);
      for (let m = 1; m <= n; m++) {
        const oldRoot = rootFromLeafHashes(leaves.slice(0, m));
        const proof = consistencyProof(m, leaves);
        expect(verifyConsistency(m, n, oldRoot, newRoot, proof), `m=${m} n=${n}`).toBe(true);
      }
    }
  });

  it("rejects a consistency proof when history was rewritten", () => {
    const leaves = leavesOf(20);
    const oldRoot = rootFromLeafHashes(leaves.slice(0, 11));
    const rewritten = [...leaves];
    rewritten[3] = leafHash(utf8("rewritten"));
    const proof = consistencyProof(11, rewritten);
    expect(verifyConsistency(11, 20, oldRoot, rootFromLeafHashes(rewritten), proof)).toBe(false);
  });
});
