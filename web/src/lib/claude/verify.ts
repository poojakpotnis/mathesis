import Anthropic from "@anthropic-ai/sdk";
import { llmSpan } from "@/lib/otel/tracer";

const MODEL = "claude-opus-4-6";

export type VerifyInput = {
  problemText: string;
  expectedAnswer: string;
  answerFormatType: string;
  gradeLevel: number;
};

export type VerifyVerdict = "verified" | "flagged";

export type VerifyResult = {
  verificationStatus: VerifyVerdict;
  verificationDetails: string;
  independentAnswer: string;
  normalizedExpected: string;
  normalizedIndependent: string;
  // OTel IDs of the `mathesis.verify.solve` span (hex, no `0x` prefix).
  // Persisted alongside the row so a later parent override can push a
  // Phoenix annotation onto the exact verifier trace that produced this
  // verdict.
  verifySpanId: string;
  verifyTraceId: string;
};

type SolveResponse = {
  answer: string;
  steps: string;
  confidence: number;
};

type SolveWithSpan = {
  parsed: SolveResponse;
  spanId: string;
  traceId: string;
};

function buildSystemPrompt(gradeLevel: number): string {
  return `You are a careful math tutor solving a single Grade ${gradeLevel} math problem.

Solve the problem from scratch using your own reasoning. Do NOT assume any particular answer is correct — work it out yourself.

Return:
- answer: the single canonical answer string. For fractions use lowest terms like "1/6". For decimals trim trailing zeros. Use ASCII math.
- steps: 2-5 lines of worked solution, one step per line separated by \\n.
- confidence: 0.0-1.0, how confident you are in your answer.`;
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    steps: { type: "string" },
    confidence: { type: "number", description: "0.0 to 1.0" },
  },
  required: ["answer", "steps", "confidence"],
  additionalProperties: false,
};

export function normalizeAnswer(raw: string): string {
  let s = raw.trim().toLowerCase();
  // strip surrounding quotes
  s = s.replace(/^["'`]+|["'`]+$/g, "");
  // strip trailing sentence punctuation (keep internal commas — they separate values)
  s = s.replace(/[.,!?;]+$/g, "");
  // collapse whitespace
  s = s.replace(/\s+/g, " ");
  // strip $ and units padding
  s = s.replace(/\s*\$\s*/g, "");
  // unify fraction spacing: "1 / 2" -> "1/2"
  s = s.replace(/\s*\/\s*/g, "/");
  // Treat " or " as a comma separator: "x = -3 or x = 2" → "x = -3, x = 2".
  // Catches the verifier's most common surface-form deviation on multi-value
  // answers (bucket 1 of the Phase-5e parent-review pattern analysis).
  s = s.replace(/\s+or\s+/g, ", ");
  // Treat a sentence-ending period as a comma. Lookahead requires a following
  // space so decimals like 1.5 stay untouched. Catches true/false answers where
  // the verifier writes "False. ..." vs the generator's "False, ..." (bucket 3).
  s = s.replace(/\.(?=\s)/g, ",");
  // Strip repeated "var = " prefixes after a comma: "x = 1, x = 2" → "x = 1, 2"
  // (bucket 2). The first "var = " is left intact.
  s = s.replace(/,\s*[a-z]\s*=\s*/g, ", ");
  // trim trailing zeros on decimals: 1.50 -> 1.5, 1.00 -> 1
  if (/^-?\d+\.\d+$/.test(s)) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s.trim();
}

/**
 * Decide whether two answers are equivalent after normalization. Three
 * acceptance paths, each grounded in a real false-positive pattern observed
 * during Phase 5e parent reviews:
 *   - exact match after normalization (covers the bulk; bucket 1 collapses
 *     here because " or " is rewritten to ",")
 *   - multi-value answer with re-ordering: split on commas, sort, compare
 *     (covers e.g. "-3, 2" vs "2, -3")
 *   - true/false answer where the verifier appended an explanatory clause:
 *     require matching True/False verdicts AND that every non-trivial token
 *     in the expected correction appears somewhere in the independent text
 */
export function answersMatch(expected: string, independent: string): boolean {
  const e = normalizeAnswer(expected);
  const i = normalizeAnswer(independent);
  if (e === i) return true;

  // Multi-value with reordering
  const eParts = e.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  const iParts = i.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (eParts.length > 1 && eParts.length === iParts.length) {
    const eSorted = [...eParts].sort().join("|");
    const iSorted = [...iParts].sort().join("|");
    if (eSorted === iSorted) return true;
  }

  // True/false with verbose explanation
  const eTF = e.match(/^(true|false)[\s,]+(.+)$/);
  const iTF = i.match(/^(true|false)[\s,]+(.+)$/);
  if (eTF && iTF && eTF[1] === iTF[1]) {
    const eTokens = eTF[2].split(/\s+/).filter((t) => t.length > 1);
    if (eTokens.length > 0 && eTokens.every((t) => iTF[2].includes(t))) {
      return true;
    }
  }

  return false;
}

export async function verifyProblem(input: VerifyInput): Promise<VerifyResult> {
  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt(input.gradeLevel);

  const userPrompt = [
    `Problem: ${input.problemText}`,
    `Expected answer format: ${input.answerFormatType}`,
    "",
    "Solve this problem independently and return your answer.",
  ].join("\n");

  const solved = await llmSpan<SolveWithSpan>(
    "mathesis.verify.solve",
    {
      model: MODEL,
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    },
    async (span) => {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Verifier returned no text block");
      }

      const parsed = JSON.parse(textBlock.text) as SolveResponse;
      const ctx = span.spanContext();
      return {
        result: { parsed, spanId: ctx.spanId, traceId: ctx.traceId },
        output: {
          responseText: textBlock.text,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }
  );

  const normalizedExpected = normalizeAnswer(input.expectedAnswer);
  const normalizedIndependent = normalizeAnswer(solved.parsed.answer);
  const matches = answersMatch(input.expectedAnswer, solved.parsed.answer);

  const verificationStatus: VerifyVerdict = matches ? "verified" : "flagged";
  const verificationDetails = matches
    ? `Independent solve matched expected answer "${input.expectedAnswer}" (confidence ${solved.parsed.confidence.toFixed(2)}).`
    : `MISMATCH: expected "${input.expectedAnswer}" (normalized "${normalizedExpected}"), independent solve gave "${solved.parsed.answer}" (normalized "${normalizedIndependent}", confidence ${solved.parsed.confidence.toFixed(2)}). Steps: ${solved.parsed.steps}`;

  return {
    verificationStatus,
    verificationDetails,
    independentAnswer: solved.parsed.answer,
    normalizedExpected,
    normalizedIndependent,
    verifySpanId: solved.spanId,
    verifyTraceId: solved.traceId,
  };
}
