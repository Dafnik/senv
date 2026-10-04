import type { HttpErrorResponse, HttpResponse } from '@angular/common/http';

export function headersFromFetch(
  fetchHeaders?: Headers | HeadersInit,
): Record<string, string> {
  if (!fetchHeaders) return {};
  const normalized = new Headers(fetchHeaders);
  const out: Record<string, string> = {};
  normalized.forEach((value, key) => (out[key] = value));
  return out;
}

export function processAuthResponse(
  response: HttpErrorResponse | HttpResponse<unknown>,
): Response {
  if (response.status === 0) {
    return new Response(
      JSON.stringify({
        message:
          'Cannot reach the server. Check your connection and try again.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const headers = new Headers();
  for (const key of response.headers.keys()) {
    for (const value of response.headers.getAll(key) ?? []) {
      headers.append(key, value);
    }
  }
  const hasError = 'error' in response && response.error != null;
  const hasBody = 'body' in response && response.body != null;
  const body = hasBody
    ? JSON.stringify(response.body)
    : hasError
      ? JSON.stringify(response.error)
      : null;
  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
