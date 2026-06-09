import {
  normalizeProblemText,
  findDuplicateSource,
  partitionByDuplicates,
} from "../src/lib/claude/dedupe";

let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
  }
}

console.log("dedupe.ts — normalize tests");
assert(
  normalizeProblemText("Calculate. (3/4) of ___ is (1/2) .") ===
    normalizeProblemText("Calculate. (3/4) of ___ is (1/2)."),
  "trailing-space-before-period equivalence (the pid=15/16 difference)"
);
assert(
  normalizeProblemText("Calculate. (3/4) of (1/2) is ___.") ===
    normalizeProblemText("CALCULATE.  (3/4)  of  (1/2)  is ___ ."),
  "case + whitespace insensitivity"
);
assert(
  normalizeProblemText("a/b") !== normalizeProblemText("a*b"),
  "math operators distinguished (/ vs *)"
);
assert(
  normalizeProblemText("(1/5)^2") !== normalizeProblemText("(1/5)2"),
  "exponent caret preserved"
);

console.log("\ndedupe.ts — known pid=15 vs source 11h pair");
const source11h = {
  id: 31,
  problemText: "Calculate. (3/4) of ___ is (1/2) .",
};
const generated15 = {
  problemText: "Calculate. (3/4) of ___ is (1/2) .",
};
const generated16 = {
  problemText: "Calculate. (3/4) of ___ is (1/2).",
};
const sources = [
  { id: 24, problemText: "Calculate. (1/2) of (1/3) is ___ ." },
  { id: 25, problemText: "Calculate. (1/2) of ___ is (1/3) ." },
  source11h,
];

assert(
  findDuplicateSource(generated15.problemText, sources) === 31,
  "pid=15 (' .' tail) flagged as duplicate of source 11h"
);
assert(
  findDuplicateSource(generated16.problemText, sources) === 31,
  "pid=16 ('.' tail) flagged as duplicate of source 11h"
);
assert(
  findDuplicateSource("Calculate. (3/4) of (1/8) is ___.", sources) === null,
  "novel problem (different fraction) not flagged"
);
assert(
  findDuplicateSource("Calculate. (1/2) of ___ is (1/3) .", sources) === 25,
  "another source-text match (id=25) flagged correctly"
);

console.log("\ndedupe.ts — partitionByDuplicates batch");
const batch = [
  { problemText: "Calculate. (3/4) of ___ is (1/2) ." },
  { problemText: "Calculate. (1/4) of (2/3) is ___." },
  { problemText: "Calculate. (3/4) of ___ is (1/2)." },
];
const part = partitionByDuplicates(batch, sources);
assert(
  part.accepted.length === 1 &&
    part.accepted[0].problemText === "Calculate. (1/4) of (2/3) is ___.",
  "novel problem accepted"
);
assert(
  part.dropped.length === 2 &&
    part.dropped.every((d) => d.matchedSourceId === 31),
  "both verbatim copies of 11h dropped, matchedSourceId=31"
);

console.log("\ndedupe.ts — edge cases");
assert(
  findDuplicateSource("", sources) === null,
  "empty generated text not flagged"
);
assert(
  findDuplicateSource("anything", []) === null,
  "empty source list yields null"
);

console.log("");
if (failed > 0) {
  console.log(`FAILED (${failed} assertion(s))`);
  process.exit(1);
} else {
  console.log("All assertions passed.");
}
