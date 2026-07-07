// Verifier calibration smoke test.
//
// The verifier (src/lib/claude/verify.ts) was moved from Opus 4.6 to Sonnet 5
// at effort:low to cut cost. This harness confirms the swap didn't change the
// verifier's behavior on grade-4 math: it must still return "verified" on
// correct answers and "flagged" on wrong ones. Run before trusting the swap.
//
//   cd web && npx tsx --env-file=.env.local scripts/verify_smoke.ts
//
// Costs ~8 Sonnet calls.

import { verifyProblem, type VerifyVerdict } from "@/lib/claude/verify";

type Case = {
  label: string;
  problemText: string;
  expectedAnswer: string;
  answerFormatType: string;
  want: VerifyVerdict; // what the verifier SHOULD conclude
};

// Correct answers → the independent solve should agree → "verified".
// Wrong answers → the independent solve should disagree → "flagged".
const CASES: Case[] = [
  {
    label: "division word problem (correct)",
    problemText:
      "A baker made 48 muffins and packed them equally into 6 boxes. How many muffins are in each box?",
    expectedAnswer: "8",
    answerFormatType: "numeric",
    want: "verified",
  },
  {
    label: "fraction addition (correct)",
    problemText:
      "What is (3/4) + (1/8)? Give your answer as a fraction in lowest terms.",
    expectedAnswer: "7/8",
    answerFormatType: "fraction",
    want: "verified",
  },
  {
    label: "rectangle area (correct)",
    problemText:
      "A rectangle is 7 units long and 5 units wide. What is its area in square units?",
    expectedAnswer: "35",
    answerFormatType: "numeric",
    want: "verified",
  },
  {
    label: "money multi-step (correct)",
    problemText:
      "Sara had $20.00. She bought a book for $12.50 and a pen for $2.25. How much money does she have left, in dollars?",
    expectedAnswer: "5.25",
    answerFormatType: "decimal",
    want: "verified",
  },
  {
    label: "rounding (correct)",
    problemText: "Round 3,847 to the nearest hundred.",
    expectedAnswer: "3800",
    answerFormatType: "numeric",
    want: "verified",
  },
  {
    label: "missing factor (correct)",
    problemText: "A number multiplied by 9 gives 63. What is the number?",
    expectedAnswer: "7",
    answerFormatType: "numeric",
    want: "verified",
  },
  // --- deliberately wrong expected answers: the verifier must catch these ---
  {
    label: "division word problem (WRONG answer, must flag)",
    problemText:
      "A baker made 48 muffins and packed them equally into 6 boxes. How many muffins are in each box?",
    expectedAnswer: "9",
    answerFormatType: "numeric",
    want: "flagged",
  },
  {
    label: "fraction addition (WRONG answer, must flag)",
    problemText:
      "What is (3/4) + (1/8)? Give your answer as a fraction in lowest terms.",
    expectedAnswer: "1",
    answerFormatType: "fraction",
    want: "flagged",
  },
];

async function main() {
  console.log("verifier smoke test — grade 4, model swap validation\n");
  let failed = 0;

  const results = await Promise.all(
    CASES.map(async (c) => {
      const r = await verifyProblem({
        problemText: c.problemText,
        expectedAnswer: c.expectedAnswer,
        answerFormatType: c.answerFormatType,
        gradeLevel: 4,
      });
      return { c, got: r.verificationStatus, independent: r.independentAnswer };
    })
  );

  for (const { c, got, independent } of results) {
    const ok = got === c.want;
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${c.label}\n` +
        `        want=${c.want} got=${got} (independent solve="${independent}")`
    );
  }

  console.log(
    `\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`} — ${CASES.length} cases`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
