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

function normalizeAnswer(raw: string): string {
  let s = raw.trim().toLowerCase();
  // strip surrounding quotes/punctuation
  s = s.replace(/^["'`]+|["'`.,!?]+$/g, "");
  // collapse whitespace
  s = s.replace(/\s+/g, " ");
  // strip $ and units padding
  s = s.replace(/\s*\$\s*/g, "");
  // unify fraction spacing: "1 / 2" -> "1/2"
  s = s.replace(/\s*\/\s*/g, "/");
  // trim trailing zeros on decimals: 1.50 -> 1.5, 1.00 -> 1
  if (/^-?\d+\.\d+$/.test(s)) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
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
  const matches = normalizedExpected === normalizedIndependent;

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
