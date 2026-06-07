// Next.js calls this file's `register()` exactly once at server startup, before
// any route handler imports. That ordering is what lets the OpenInference
// auto-instrumentation patch the Anthropic SDK before our business code uses it.
//
// To learn from while reading:
//   1. `resource`            = static metadata stamped on every span (who emitted it)
//   2. `spanProcessor`       = buffers spans and decides when to flush them
//   3. `exporter`            = the transport that ships spans to Phoenix
//   4. `instrumentations`    = the adapters that monkey-patch third-party SDKs
//                              so calls automatically emit OpenInference-compliant spans
export async function register() {
  // OTel Node SDK is Node-only; Next.js may also call register() in the Edge
  // runtime where this code would crash.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Dynamic imports keep these heavy modules out of the Edge bundle.
  const { diag, DiagConsoleLogger, DiagLogLevel } = await import(
    "@opentelemetry/api"
  );
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  // Phoenix only accepts protobuf-encoded OTLP at /v1/traces (rejects JSON
  // with HTTP 415). The `-proto` variant ships protobuf over HTTP.
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-proto"
  );
  const { SimpleSpanProcessor } = await import("@opentelemetry/sdk-trace-node");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME } = await import(
    "@opentelemetry/semantic-conventions"
  );
  const { SEMRESATTRS_PROJECT_NAME } = await import(
    "@arizeai/openinference-semantic-conventions"
  );

  const endpoint =
    process.env.PHOENIX_COLLECTOR_ENDPOINT ||
    "http://localhost:6006/v1/traces";

  // Phoenix Cloud requires an API key in the `api_key` header. Local
  // self-hosted Phoenix has no auth, so we only attach the header when the
  // env var is present.
  const apiKey = process.env.PHOENIX_API_KEY;
  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers: apiKey ? { api_key: apiKey } : undefined,
  });

  // NOTE on auto-instrumentation:
  // We tried @arizeai/openinference-instrumentation-anthropic but it broke
  // the Anthropic SDK's APIPromise/streaming interface (its patched
  // create() returns a plain Promise without .withResponse(), which the
  // streaming code path depends on). Rather than fight that, we capture
  // LLM attributes manually inside generate.ts / verify.ts using the same
  // OpenInference semantic-convention attribute names that Phoenix
  // understands. Explicit > magical when the magic breaks.
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "mathesis-web",
      [SEMRESATTRS_PROJECT_NAME]: "mathesis",
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  sdk.start();
  // eslint-disable-next-line no-console
  console.log(
    `[otel] Phoenix tracing initialized → ${endpoint} (project: mathesis, auth: ${apiKey ? "yes" : "no"})`
  );
}
