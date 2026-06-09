// Utilities for catching generator output that verbatim-duplicates a lesson
// source problem. The Phase 5h v2 LLM judge surfaced 3/65 generated problems
// (~5%) that exactly matched a source problem text (all three were source
// 11h, "Calculate. (3/4) of ___ is (1/2)."), even when the generator's
// claimed sourceScrapedProblemId pointed elsewhere. So the matcher compares
// against the full lesson source set, not just the claimed source.

export type SourceProblem = { id: number; problemText: string };

export function normalizeProblemText(s: string | null | undefined): string {
  if (!s) return "";
  let n = s.normalize("NFKC").toLowerCase();
  n = n.replace(/[^\w\s/()^]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

export function findDuplicateSource(
  generatedText: string,
  sources: SourceProblem[]
): number | null {
  const target = normalizeProblemText(generatedText);
  if (!target) return null;
  for (const s of sources) {
    if (normalizeProblemText(s.problemText) === target) {
      return s.id;
    }
  }
  return null;
}

export type DedupePartition<T> = {
  accepted: T[];
  dropped: { item: T; matchedSourceId: number }[];
};

export function partitionByDuplicates<T extends { problemText: string }>(
  generated: T[],
  sources: SourceProblem[]
): DedupePartition<T> {
  const accepted: T[] = [];
  const dropped: { item: T; matchedSourceId: number }[] = [];
  for (const item of generated) {
    const matchId = findDuplicateSource(item.problemText, sources);
    if (matchId === null) {
      accepted.push(item);
    } else {
      dropped.push({ item, matchedSourceId: matchId });
    }
  }
  return { accepted, dropped };
}
