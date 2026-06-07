import {
  trace,
  SpanStatusCode,
  type Span,
  type Attributes,
} from "@opentelemetry/api";
import { SemanticConventions } from "@arizeai/openinference-semantic-conventions";

// One named Tracer per service-component is the convention. Phoenix uses the
// tracer name to group/filter manual spans separately from auto-instrumented
// ones. (Anthropic SDK calls use the OpenInference instrumentation's tracer.)
export const tracer = trace.getTracer("mathesis-web");

/**
 * Wrap an async block in a span that becomes the current ("active") span for
 * its duration. Anything that creates spans inside `fn` — including the
 * Anthropic SDK auto-instrumentation — becomes a child of this span in the
 * Phoenix trace tree.
 *
 * Why this helper exists rather than calling startActiveSpan directly:
 *  - guarantees the span is always ended (try/finally)
 *  - records exceptions and sets ERROR status on throw, so failures show up
 *    correctly in Phoenix instead of looking like silent successes
 *  - hands the span back to the caller so it can add outcome attributes
 *    (verified_count, flagged_count, etc.) after the work completes
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * LLM-call span that emits OpenInference-conventioned attributes.
 *
 * What this teaches:
 *  - The *exact* attribute names Phoenix looks for to render the "Input",
 *    "Output", and "Token Counts" panels in its trace UI.
 *  - That auto-instrumentation isn't magic — it just sets these same
 *    attributes for you. Doing it manually lets you keep the SDK happy and
 *    still get the rich Phoenix views.
 *  - The pattern of "set inputs up front, run the call, set outputs after,
 *    end the span" generalizes to evaluators, retrievers, and tool calls.
 *
 * Args mirror an Anthropic messages.create call: a model name, an optional
 * system prompt, the user/assistant messages, and a fn that returns the
 * raw response (so the caller still owns the SDK call).
 */
export type LlmInputMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type LlmCaptureInput = {
  model: string;
  systemPrompt?: string;
  messages: LlmInputMessage[];
};

export type LlmCaptureOutput = {
  responseText: string;
  inputTokens: number;
  outputTokens: number;
};

export async function llmSpan<T>(
  name: string,
  input: LlmCaptureInput,
  fn: (
    span: Span
  ) => Promise<{ result: T; output: LlmCaptureOutput }>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    // Mark this span as an LLM call so Phoenix renders the LLM-specific UI
    // (Input/Output/Tokens tabs) instead of the generic span panel.
    span.setAttribute(
      SemanticConventions.OPENINFERENCE_SPAN_KIND,
      "LLM"
    );
    span.setAttribute(SemanticConventions.LLM_SYSTEM, "anthropic");
    span.setAttribute(SemanticConventions.LLM_PROVIDER, "anthropic");
    span.setAttribute(SemanticConventions.LLM_MODEL_NAME, input.model);

    // Phoenix expects indexed message attributes like
    // `llm.input_messages.0.message.role` and `.content`. The system prompt
    // occupies index 0 when present, then user/assistant messages follow.
    const inputMessages: LlmInputMessage[] = input.systemPrompt
      ? [{ role: "system", content: input.systemPrompt }, ...input.messages]
      : input.messages;
    inputMessages.forEach((m, i) => {
      span.setAttribute(
        `${SemanticConventions.LLM_INPUT_MESSAGES}.${i}.message.role`,
        m.role
      );
      span.setAttribute(
        `${SemanticConventions.LLM_INPUT_MESSAGES}.${i}.message.content`,
        m.content
      );
    });
    // `input.value` is the canonical "raw input" that Phoenix shows at the
    // top of an LLM span. Helpful when the message-array view feels noisy.
    span.setAttribute(
      SemanticConventions.INPUT_VALUE,
      JSON.stringify(inputMessages)
    );
    span.setAttribute(SemanticConventions.INPUT_MIME_TYPE, "application/json");

    try {
      const { result, output } = await fn(span);

      span.setAttribute(
        SemanticConventions.LLM_TOKEN_COUNT_PROMPT,
        output.inputTokens
      );
      span.setAttribute(
        SemanticConventions.LLM_TOKEN_COUNT_COMPLETION,
        output.outputTokens
      );
      span.setAttribute(
        SemanticConventions.LLM_TOKEN_COUNT_TOTAL,
        output.inputTokens + output.outputTokens
      );
      span.setAttribute(
        `${SemanticConventions.LLM_OUTPUT_MESSAGES}.0.message.role`,
        "assistant"
      );
      span.setAttribute(
        `${SemanticConventions.LLM_OUTPUT_MESSAGES}.0.message.content`,
        output.responseText
      );
      span.setAttribute(SemanticConventions.OUTPUT_VALUE, output.responseText);
      span.setAttribute(SemanticConventions.OUTPUT_MIME_TYPE, "text/plain");

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
