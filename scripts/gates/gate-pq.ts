/**
 * Post-quantum gate: confirm ML-DSA-65 works on this Node version through @noble/post-quantum,
 * report signature sizes and timing, and check whether Node's own crypto has ML-DSA yet
 * (it arrived in Node 24.6 with OpenSSL 3.5; the project runs on Node 22).
 */
import { generateKeyPairSync } from "node:crypto";
import { mlDsa65Signer, utf8, verifySignature } from "@handoff/trust";

const message = utf8("handoff.demo/receipts/v1\n23\nroot\nissued 2026-11-05T17:23:00.000Z\n");
const t0 = performance.now();
const signer = mlDsa65Signer("gate-pq", "system");
const t1 = performance.now();
const runs = 20;
let sig = signer.sign(message);
const t2 = performance.now();
for (let i = 1; i < runs; i++) sig = signer.sign(message);
const t3 = performance.now();
let ok = true;
for (let i = 0; i < runs; i++) {
  ok &&= verifySignature(signer.publicKey, message, { alg: "ML-DSA-65", kid: "gate-pq", value: Buffer.from(sig).toString("base64url") });
}
const t4 = performance.now();
const tampered = verifySignature(signer.publicKey, utf8("something else"), { alg: "ML-DSA-65", kid: "gate-pq", value: Buffer.from(sig).toString("base64url") });

let nativeMlDsa = "no";
try {
  generateKeyPairSync("ml-dsa-65" as never);
  nativeMlDsa = "yes";
} catch {
  nativeMlDsa = "no";
}

console.log(`Node ${process.version}; native ML-DSA in node:crypto: ${nativeMlDsa}`);
console.log(`ML-DSA-65 public key ${Buffer.from(signer.publicKey.publicKey, "base64url").length} bytes, signature ${sig.length} bytes`);
console.log(`keygen ${(t1 - t0).toFixed(1)} ms · sign ${((t3 - t2) / (runs - 1)).toFixed(2)} ms avg · verify ${((t4 - t3) / runs).toFixed(2)} ms avg`);
console.log(`verifies: ${ok} · rejects a different message: ${!tampered}`);
const pass = ok && !tampered && sig.length === 3309;
console.log(pass ? "Gate PQ: PASS" : "Gate PQ: FAIL");
process.exitCode = pass ? 0 : 1;
