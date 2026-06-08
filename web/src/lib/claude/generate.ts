import Anthropic from "@anthropic-ai/sdk";
import { llmSpan } from "@/lib/otel/tracer";

const MODEL = "claude-opus-4-6";

export type GeneratorInputConcept = {
  id: number;
  name: string;
  displayName: string;
  category: string;
  exampleProblems?: { id: number; problemText: string }[];
};

export type GeneratorDifficulty = "easier" | "match" | "harder" | "progressive";

export type GeneratorAnswerFormat =
  | "numeric"
  | "fraction"
  | "decimal"
  | "expression"
  | "text"
  | "multiple_choice";

export type GeneratedProblem = {
  problemText: string;
  problemLatex: string | null;
  correctAnswer: string;
  answerFormatType: GeneratorAnswerFormat;
  solutionSteps: string | null;
  difficultyRating: number;
  sourceScrapedProblemId: number | null;
  conceptNames: string[];
};

export type GeneratorResult = {
  problems: GeneratedProblem[];
};

const DIFFICULTY_GUIDANCE: Record<GeneratorDifficulty, string> = {
  easier:
    "Generate problems that are slightly EASIER than the source examples — use smaller numbers, simpler fractions, or fewer steps. Useful for building confidence.",
  match:
    "Generate problems that closely MATCH the difficulty of the source examples — same number ranges, same operation complexity, same step count.",
  harder:
    "Generate problems that are slightly HARDER than the source examples — larger numbers, more steps, or trickier setups. Still solvable at the same grade level.",
  progressive:
    "Generate problems in PROGRESSIVE difficulty: start with 1-2 warm-up problems matching the source, then gradually ramp up to harder variants by the last problems.",
};

function buildSystemPrompt(gradeLevel: number): string {
  return `You are a math curriculum expert creating practice problems for a Grade ${gradeLevel} student.

Your task: generate practice problems that exercise the given concepts, modeled after the source example problems where provided.

Guidelines:
1. Each problem must test at least one of the provided concepts. Set conceptNames to the concept name(s) it exercises (use the exact \`name\` field from the input).
2. Write problems in clear, age-appropriate English. Avoid jargon.
3. Use ASCII math notation in problemText: write fractions as (numerator/denominator), exponents as base^exponent, and use * for multiplication. Do NOT embed LaTeX in problemText.
4. If a problem benefits from rendered math, ALSO provide problemLatex with proper LaTeX (e.g. "\\\\frac{1}{2} \\\\times \\\\frac{1}{3}"). Otherwise set problemLatex to null.
5. correctAnswer must be a single canonical answer string. For fractions use lowest terms like "1/6". For decimals trim trailing zeros. For text answers be concise.
6. answerFormatType: pick from numeric, fraction, decimal, expression, text, multiple_choice.
7. solutionSteps: a short worked solution (2-5 lines) the parent can use to grade and explain. Use plain text with ASCII math; one step per line separated by \\n. Set to null only if truly trivial.
8. difficultyRating: integer 1-5. 1=easier than source, 3=matches source, 5=much harder.
9. sourceScrapedProblemId: if you closely modeled this problem after one of the example problems, set this to that scraped_problem id. Otherwise null.
10. Vary the surface form. Don't just change numbers — vary phrasing, contexts (word problems vs. pure computation), and presentation. The student should not feel they're solving the same problem 10 times.
11. Every problem must be unambiguous, solvable with the listed concepts only, and have a single correct answer that you can verify yourself.`;
}

const ANSWER_FORMAT_TYPES = [
  "numeric",
  "fraction",
  "decimal",
  "expression",
  "text",
  "multiple_choice",
] as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          problemText: {
            type: "string",
            description: "Problem statement in plain English with ASCII math",
          },
          problemLatex: {
            type: ["string", "null"],
            description: "Optional LaTeX rendering of the problem",
          },
          correctAnswer: {
            type: "string",
            description: "Single canonical answer string",
          },
          answerFormatType: {
            type: "string",
            enum: [...ANSWER_FORMAT_TYPES],
          },
          solutionSteps: {
            type: ["string", "null"],
            description: "Short worked solution, plain text, lines separated by \\n",
          },
          difficultyRating: {
            type: "integer",
            description: "Integer 1-5 (1=easier than source, 3=matches, 5=much harder)",
          },
          sourceScrapedProblemId: {
            type: ["integer", "null"],
            description: "scraped_problem.id this problem was modeled after, if any",
          },
          conceptNames: {
            type: "array",
            items: { type: "string" },
            description: "Concept name(s) (snake_case) this problem exercises",
          },
        },
        required: [
          "problemText",
          "problemLatex",
          "correctAnswer",
          "answerFormatType",
          "solutionSteps",
          "difficultyRating",
          "sourceScrapedProblemId",
          "conceptNames",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["problems"],
  additionalProperties: false,
};

function formatConceptForPrompt(c: GeneratorInputConcept): string {
  const lines = [
    `CONCEPT: ${c.name}`,
    `  Display: ${c.displayName}`,
    `  Category: ${c.category}`,
  ];
  if (c.exampleProblems && c.exampleProblems.length > 0) {
    lines.push("  Source examples:");
    for (const ex of c.exampleProblems) {
      lines.push(`    [scraped_problem_id=${ex.id}] ${ex.problemText}`);
    }
  }
  return lines.join("\n");
}

export async function generateProblems(args: {
  concepts: GeneratorInputConcept[];
  count: number;
  difficulty: GeneratorDifficulty;
  lessonTitle: string;
  gradeLevel: number;
}): Promise<GeneratorResult> {
  const { concepts, count, difficulty, lessonTitle, gradeLevel } = args;
  const systemPrompt = buildSystemPrompt(gradeLevel);
  if (concepts.length === 0 || count <= 0) {
    return { problems: [] };
  }

  const client = new Anthropic();

  const conceptNamesAllowed = concepts.map((c) => c.name);

  const userPrompt = [
    `Lesson: ${lessonTitle}`,
    `Number of problems to generate: ${count}`,
    `Difficulty target: ${difficulty} — ${DIFFICULTY_GUIDANCE[difficulty]}`,
    `Allowed concept names (use these exact strings in conceptNames): ${conceptNamesAllowed.join(", ")}`,
    "",
    concepts.map(formatConceptForPrompt).join("\n\n"),
    "",
    `Generate exactly ${count} problems following the guidelines.`,
  ].join("\n");

  return llmSpan(
    "mathesis.generate.problems",
    {
      model: MODEL,
      systemPrompt: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    },
    async () => {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
      });
      const response = await stream.finalMessage();

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Generator returned no text block");
      }

      const parsed = JSON.parse(textBlock.text) as GeneratorResult;
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
}
