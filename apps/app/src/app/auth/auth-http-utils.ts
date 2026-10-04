import type { HttpErrorResponse, HttpResponse } from '@angular/common/http';

export function headersFromFetch(
  fetchHeaders?: Headers | HeadersInit,
): Record<string, string> {
  if (!fetchHeaders) return {};
  if (fetchHeaders instanceof Headers) {
    const out: Record<string, string> = {};
    fetchHeaders.forEach((value, key) => (out[key] = value));
    return out;
  }
  if (Array.isArray(fetchHeaders)) return Object.fromEntries(fetchHeaders);
  return fetchHeaders;
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
  const allHeaders = response.headers
    .keys()
    .map((key) => [
      key,
      response.headers.getAll(key),
    ]) as unknown as HeadersInit;
  const hasError = 'error' in response && !!response.error;
  const hasBody = 'body' in response && !!response.body;
  const body = hasBody
    ? JSON.stringify(response.body)
    : hasError
      ? JSON.stringify(response.error)
      : null;
  return new Response(body, {
    headers: new Headers(allHeaders),
    status: response.status,
    statusText: response.statusText,
  });
}
