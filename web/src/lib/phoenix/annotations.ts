// Phase 5e: push a span annotation back to Phoenix when a parent overrides
// the verifier's verdict on a generated problem.
//
// Phoenix is local-only (see project_progress.md). PHOENIX_BASE_URL lets a
// future hosted setup point at a different host without code change. The
// instrumentation OTLP exporter uses the same env shape (PHOENIX_COLLECTOR_
// ENDPOINT) — keeping a separate var for the REST API avoids tangling the
// two endpoints (collector is typically /v1/traces, REST is /v1/...).

const PHOENIX_BASE_URL =
  process.env.PHOENIX_BASE_URL ?? "http://localhost:6006";

export type AnnotationInput = {
  spanId: string;
  name: string;
  label: string;
  score: number;
  explanation?: string;
  // When supplied, Phoenix upserts the annotation keyed on (spanId, name,
  // identifier). Use it to ensure repeated parent clicks don't pile up
  // duplicate annotations on the same span.
  identifier?: string;
  metadata?: Record<string, unknown>;
};

export type AnnotationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function pushSpanAnnotation(
  input: AnnotationInput
): Promise<AnnotationResult> {
  try {
    const res = await fetch(`${PHOENIX_BASE_URL}/v1/span_annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            span_id: input.spanId,
            name: input.name,
            annotator_kind: "HUMAN",
            result: {
              label: input.label,
              score: input.score,
              explanation: input.explanation ?? null,
            },
            identifier: input.identifier ?? "",
            metadata: input.metadata ?? null,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Phoenix annotation HTTP ${res.status}: ${body.slice(0, 300)}`,
      };
    }

    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const id = json.data?.[0]?.id ?? "";
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
