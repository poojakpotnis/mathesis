import Anthropic from "@anthropic-ai/sdk";
import { llmSpan } from "@/lib/otel/tracer";

export type ClassifierInputProblem = {
  id: number;
  problemNumber: string;
  problemText: string;
  hintText: string | null;
  hasImage: boolean;
  imageDescription: string | null;
};

export type ClassifierConcept = {
  name: string;
  displayName: string;
  category: string;
  description: string;
};

// The existing taxonomy we prime the classifier with. Same shape as ClassifierConcept
// minus any database-only fields — the model only needs to see what defines the concept.
export type ClassifierLibraryConcept = {
  name: string;
  displayName: string;
  category: string;
  description: string;
};

export type ClassifierProblemMapping = {
  problem_id: number;
  concepts: { name: string; confidence: number }[];
};

export type ClassifierResult = {
  concepts: ClassifierConcept[];
  problem_classifications: ClassifierProblemMapping[];
};

const CATEGORIES = [
  "arithmetic",
  "fractions",
  "algebra",
  "geometry",
  "measurement",
  "number_theory",
  "ratios_proportions",
  "exponents",
  "logic_reasoning",
  "word_problems",
] as const;

const BASE_SYSTEM_PROMPT = `You are a math curriculum expert classifying homework problems for a 4th-grade student.

Your task: identify the mathematical concepts each problem tests, then return a unified concept taxonomy plus per-problem mappings.

Guidelines:
1. Use the SAME concept \`name\` across problems that test the same skill. Reuse aggressively — "fraction_multiplication" should appear once in the concepts array, then be referenced by every problem that needs it.
2. \`name\`: snake_case, specific. Prefer "fraction_multiplication" over "multiplication".
3. \`displayName\`: human-readable Title Case, e.g. "Multiplying Fractions".
4. \`category\`: one of [${CATEGORIES.join(", ")}].
5. \`description\`: one-sentence definition of the concept.
6. A problem may test multiple concepts — list them all.
7. \`confidence\`: 1.0 = obvious from the text; 0.7-0.9 = likely; 0.5-0.7 = uncertain (e.g. image-only problems with thin text).
8. Image-only or image-heavy problems are harder to classify — assign best-guess concepts with lower confidence rather than skipping.
9. Every problem in the input MUST appear exactly once in problem_classifications, using the same numeric problem_id from the input. The input format is "PROBLEM <id> (#<problemNumber>):" — the problem_id you return is the numeric <id> (e.g. 1, 2, 3), NOT the human-readable <problemNumber> (e.g. 10a, 7a, 11h). Echoing the problemNumber as problem_id is a critical mistake.
10. Every concept name referenced in problem_classifications MUST appear in the concepts array.`;

const LIBRARY_PREAMBLE = `EXISTING CONCEPT LIBRARY

The taxonomy below is the canonical list of concepts already in use across previously-classified lessons. Reuse these names whenever a problem fits one of them — even when a synonym (e.g. "zero_product_property" vs "solving_equations_products") feels more natural. Consistency across lessons is more valuable than picking the most technically precise name per batch.

Only invent a new concept name when none of the existing concepts describes the mathematical skill being tested. When you do invent a new one, follow the snake_case naming convention and pick a name that sits naturally alongside the existing library.

Library:`;

function buildSystemPrompt(existingConcepts: ClassifierLibraryConcept[]): string {
  if (existingConcepts.length === 0) {
    return BASE_SYSTEM_PROMPT;
  }
  const formatted = existingConcepts
    .map(
      (c) =>
        `- ${c.name} ("${c.displayName}", ${c.category}): ${c.description}`
    )
    .join("\n");
  return `${BASE_SYSTEM_PROMPT}\n\n${LIBRARY_PREAMBLE}\n${formatted}`;
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "snake_case unique identifier, e.g. fraction_multiplication",
          },
          displayName: {
            type: "string",
            description: "Title Case human-readable name, e.g. Multiplying Fractions",
          },
          category: { type: "string", enum: [...CATEGORIES] },
          description: { type: "string", description: "one-sentence definition" },
        },
        required: ["name", "displayName", "category", "description"],
        additionalProperties: false,
      },
    },
    problem_classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          problem_id: { type: "integer" },
          concepts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                confidence: { type: "number" },
              },
              required: ["name", "confidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["problem_id", "concepts"],
        additionalProperties: false,
      },
    },
  },
  required: ["concepts", "problem_classifications"],
  additionalProperties: false,
};

function formatProblemForPrompt(p: ClassifierInputProblem): string {
  const parts = [`PROBLEM ${p.id} (#${p.problemNumber}):`, p.problemText];
  if (p.hintText) parts.push(`HINT: ${p.hintText}`);
  if (p.hasImage) {
    parts.push(
      p.imageDescription
        ? `[IMAGE PRESENT: ${p.imageDescription}]`
        : `[IMAGE PRESENT — text alone may be insufficient]`
    );
  }
  return parts.join("\n");
}

export async function classifyProblems(
  problems: ClassifierInputProblem[],
  lessonTitle: string,
  existingConcepts: ClassifierLibraryConcept[] = []
): Promise<ClassifierResult> {
  if (problems.length === 0) {
    return { concepts: [], problem_classifications: [] };
  }

  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt(existingConcepts);

  const userPrompt = [
    `Lesson: ${lessonTitle}`,
    `Total problems: ${problems.length}`,
    "",
    problems.map(formatProblemForPrompt).join("\n\n"),
  ].join("\n");

  return llmSpan(
    "mathesis.classify.lesson",
    {
      model: "claude-sonnet-4-6",
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    },
    async () => {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Classifier returned no text block");
      }

      return {
        result: JSON.parse(textBlock.text) as ClassifierResult,
        output: {
          responseText: textBlock.text,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }
  );
}
