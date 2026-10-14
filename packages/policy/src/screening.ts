/**
 * Demo sanctions screening. Exact name matches block; near matches go to a person.
 * The bundled list is fictional. A real deployment would load OFAC's SDN list and record
 * the hash of the exact file it screened against.
 */
import { domainHash, type Sha256Ref } from "@handoff/trust";
import demoList from "../data/demo-screening-list.json" with { type: "json" };

export type ScreeningList = {
  label: string;
  version: string;
  entries: { id: string; name: string; type: "individual" | "entity" }[];
};

export type ScreeningResult = {
  result: "clear" | "review" | "match";
  matchedEntryId?: string;
  listVersion: string;
  listSha256: Sha256Ref;
};

export const DEMO_SCREENING_LIST = demoList as ScreeningList;

const NOISE = new Set(["llc", "inc", "ltd", "co", "corp", "the", "and", "of", "sa", "gmbh"]);

export function nameTokens(name: string): Set<string> {
  const plain = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return new Set(plain.split(" ").filter((t) => t && !NOISE.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function listHash(list: ScreeningList): Sha256Ref {
  return domainHash("a2h-screening-list-v1", list);
}

export function screenName(name: string, list: ScreeningList = DEMO_SCREENING_LIST): ScreeningResult {
  const base = { listVersion: list.version, listSha256: listHash(list) };
  const tokens = nameTokens(name);
  let review: string | undefined;
  for (const entry of list.entries) {
    const entryTokens = nameTokens(entry.name);
    const score = jaccard(tokens, entryTokens);
    if (score === 1) return { ...base, result: "match", matchedEntryId: entry.id };
    const containsAll = [...entryTokens].every((t) => tokens.has(t)) || ([...tokens].every((t) => entryTokens.has(t)) && tokens.size >= 2);
    if (!review && (score >= 0.5 || containsAll)) review = entry.id;
  }
  return review ? { ...base, result: "review", matchedEntryId: review } : { ...base, result: "clear" };
}
