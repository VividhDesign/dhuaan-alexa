// AWS Lambda entry: API Gateway HTTP API (payload v2) event -> Web Request -> Response.
import { createApp } from "./app.js";
import { getLatest } from "./data.js";

const app = createApp();

interface HttpEvent {
  rawPath: string; rawQueryString?: string; headers?: Record<string, string>; body?: string; isBase64Encoded?: boolean;
  requestContext: { http: { method: string }; domainName: string };
}

export async function handler(event: HttpEvent | { warmup: true }) {
  if ("warmup" in event) { await getLatest(); return { ok: true }; } // scheduled keep-warm ping
  const method = event.requestContext.http.method;
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf-8") : undefined;
  const res = await app(new Request(`https://${event.requestContext.domainName}${event.rawPath}${qs}`, {
    method, headers: event.headers ?? {}, body: method === "GET" || method === "HEAD" ? undefined : body,
  }));
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { statusCode: res.status, headers, body: await res.text(), isBase64Encoded: false };
}
