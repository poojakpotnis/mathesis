import Anthropic from "@anthropic-ai/sdk";
import { llmSpan } from "@/lib/otel/tracer";

// Generation is the core of the feature (novel, self-contained, non-leaking
// problems + figures), so it stays on Opus — the top tier — at full thinking.
// Opus 4.6/4.7/4.8 are all priced the same ($5/$25 per 1M), so tracking the
// latest Opus is a free quality upgrade with no cost change. Cost savings come
// from the verifier (Sonnet 5), never from compromising here.
const MODEL = "claude-opus-4-8";

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
  figureSvg: string | null;
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

// The model occasionally double-escapes non-ASCII in the SVG string it emits,
// so a degree sign arrives as the literal 6 characters `°` instead of `°`
// and renders verbatim in the figure (on screen and in the PDF). Decode any
// stray `\uXXXX` back to its character. A literal backslash-u sequence has no
// legitimate meaning inside SVG markup, so this is safe.
export function decodeSvgEscapes(svg: string): string {
  return svg.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

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

function buildSystemPrompt(gradeLevel: number, figuresOnly = false): string {
  const base = `You are a math curriculum expert creating practice problems for a Grade ${gradeLevel} student.

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
10. Vary the surface form. Don't just change numbers — vary phrasing, contexts (word problems vs. pure computation), and presentation. The student should not feel they're solving the same problem 10 times. You must NOT reproduce any source example problem verbatim; every generated problem must differ substantively (different numbers AND/OR different phrasing) from every source example.
11. Every problem must be unambiguous, solvable with the listed concepts only, and have a single correct answer that you can verify yourself.

FIGURES (number lines, labeled shapes, bar models, coordinate grids, fraction bars, etc.):
12. TEXT IS THE SOURCE OF TRUTH. If a problem uses a figure, problemText MUST independently state every quantity, label, and spatial relationship the figure shows — enough that a reader who cannot see the figure could still solve it completely. The figure only re-states, in a picture, facts already in the text. Never put a number ONLY in the figure.
13. NEVER LABEL A VALUE THE STUDENT MUST FIND OR DERIVE. The figure may only show quantities that are GIVEN in problemText. If a dimension is unknown or must be computed, either leave it unlabeled or label it with the given relationship/variable — never the solved number. Example: for "The length of a rectangle is 3 times its width and 10 units longer than it is wide; find the area", the width and length are what the student solves for, so do NOT label the sides "5" and "15". Instead label the short side "w" and the long side "3w" (or leave a side marked "?"). Putting the answer on the figure ruins the problem.
14. SVG requirements: a single <svg> element with a viewBox (no fixed width/height); no external references (no external fonts, images, hrefs, scripts, or event handlers); dark strokes and labels (#1a1a1a) on a white background; font-size around 14-16 in viewBox units. ALL text and shapes must sit FULLY INSIDE the viewBox with at least ~15 units of margin from every edge — make the viewBox large enough that no label is clipped (labels on the right/bottom are the usual offenders; give them room). Every number/label in the figure must also appear in problemText (per rules 12-13).
15. When a figure genuinely helps a Grade ${gradeLevel} student AND can be drawn correctly from the given facts, set figureSvg to such an SVG; otherwise set it to null. Prefer null over a figure you are not confident is correct and non-leaking — a wrong or answer-revealing figure is worse than none, and the text already carries the problem. Do NOT emit a figure for purely computational or verbal problems (no spatial/visual structure). Most problems should have figureSvg = null.`;

  if (!figuresOnly) return base;

  return (
    base +
    `

FIGURE-ONLY MODE (overrides guideline 15's "most problems null"): EVERY problem you generate MUST include a valid figureSvg — never null. Only generate problems that are genuinely visual and can be drawn correctly WITHOUT revealing the answer: number lines, labeled rectangles/triangles/polygons, angle diagrams, bar models, fraction bars or circles, coordinate grids and points, area/perimeter on a drawn shape, nets of 3D shapes, path-tracing grids, etc. Aim for VARIETY — use several different figure types across the set, not the same shape repeated. Every figure must still obey rules 12-14 (text self-contained, labels show only GIVEN quantities never the solved answer, all labels inside the viewBox). If a concept cannot be turned into a correct, non-leaking, self-contained figure, choose a different visual problem instead — do NOT emit a text-only problem, and do NOT emit a figure whose meaning lives only in the picture (e.g. "find the area of THIS shape" with an arbitrary undescribable outline).`
  );
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
          figureSvg: {
            type: ["string", "null"],
            description:
              "Self-contained SVG figure (single <svg> with viewBox, no external refs), or null. Every number/label in it must also appear in problemText.",
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
          "figureSvg",
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
  avoidProblems?: { id: number; problemText: string }[];
  figuresOnly?: boolean;
}): Promise<GeneratorResult> {
  const { concepts, count, difficulty, lessonTitle, gradeLevel, avoidProblems, figuresOnly } = args;
  const systemPrompt = buildSystemPrompt(gradeLevel, figuresOnly);
  if (concepts.length === 0 || count <= 0) {
    return { problems: [] };
  }

  const client = new Anthropic();

  const conceptNamesAllowed = concepts.map((c) => c.name);

  const userPromptParts = [
    `Lesson: ${lessonTitle}`,
    `Number of problems to generate: ${count}`,
    `Difficulty target: ${difficulty} — ${DIFFICULTY_GUIDANCE[difficulty]}`,
    `Allowed concept names (use these exact strings in conceptNames): ${conceptNamesAllowed.join(", ")}`,
    "",
    concepts.map(formatConceptForPrompt).join("\n\n"),
  ];
  if (avoidProblems && avoidProblems.length > 0) {
    userPromptParts.push("");
    userPromptParts.push(
      "CRITICAL: Do NOT reproduce any of the following problems. These include source examples and problems already used on other recent worksheets for this lesson. Every generated problem must differ substantively in BOTH numbers AND phrasing from each entry below — a new worksheet should feel fresh, not like a reprint of an earlier one:"
    );
    for (const p of avoidProblems) {
      userPromptParts.push(`  [forbidden_id=${p.id}] ${p.problemText}`);
    }
  }
  userPromptParts.push("");
  userPromptParts.push(`Generate exactly ${count} problems following the guidelines.`);
  const userPrompt = userPromptParts.join("\n");

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
      for (const problem of parsed.problems) {
        if (problem.figureSvg) {
          problem.figureSvg = decodeSvgEscapes(problem.figureSvg);
        }
      }
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
