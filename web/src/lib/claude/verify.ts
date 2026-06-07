import Anthropic from "@anthropic-ai/sdk";
import { llmSpan } from "@/lib/otel/tracer";

const MODEL = "claude-opus-4-6";

export type VerifyInput = {
  problemText: string;
  expectedAnswer: string;
  answerFormatType: string;
};

export type VerifyVerdict = "verified" | "flagged";

export type VerifyResult = {
  verificationStatus: VerifyVerdict;
  verificationDetails: string;
  independentAnswer: string;
  normalizedExpected: string;
  normalizedIndependent: string;
};

type SolveResponse = {
  answer: string;
  steps: string;
  confidence: number;
};

const SYSTEM_PROMPT = `You are a careful math tutor solving a single 4th-grade math problem.

Solve the problem from scratch using your own reasoning. Do NOT assume any particular answer is correct — work it out yourself.

Return:
- answer: the single canonical answer string. For fractions use lowest terms like "1/6". For decimals trim trailing zeros. Use ASCII math.
- steps: 2-5 lines of worked solution, one step per line separated by \\n.
- confidence: 0.0-1.0, how confident you are in your answer.`;

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

  const userPrompt = [
    `Problem: ${input.problemText}`,
    `Expected answer format: ${input.answerFormatType}`,
    "",
    "Solve this problem independently and return your answer.",
  ].join("\n");

  const solved = await llmSpan(
    "mathesis.verify.solve",
    {
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    },
    async () => {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
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
      return {
        result: parsed,
        output: {
          responseText: textBlock.text,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }
  );

  const normalizedExpected = normalizeAnswer(input.expectedAnswer);
  const normalizedIndependent = normalizeAnswer(solved.answer);
  const matches = normalizedExpected === normalizedIndependent;

  const verificationStatus: VerifyVerdict = matches ? "verified" : "flagged";
  const verificationDetails = matches
    ? `Independent solve matched expected answer "${input.expectedAnswer}" (confidence ${solved.confidence.toFixed(2)}).`
    : `MISMATCH: expected "${input.expectedAnswer}" (normalized "${normalizedExpected}"), independent solve gave "${solved.answer}" (normalized "${normalizedIndependent}", confidence ${solved.confidence.toFixed(2)}). Steps: ${solved.steps}`;

  return {
    verificationStatus,
    verificationDetails,
    independentAnswer: solved.answer,
    normalizedExpected,
    normalizedIndependent,
  };
}
