import { HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject, REQUEST } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export function cookiesInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const ssrRequest: Request | null = inject(REQUEST);
  const apiURL = environment.apiUrl;
  const isOwnAPI = isOwnApiRequest(req.url, apiURL);

  if (isOwnAPI) {
    const clonedReq: HttpRequest<unknown> = req.clone({
      withCredentials: true,
      ...(ssrRequest
        ? {
            headers: req.headers.append(
              'Cookie',
              ssrRequest.headers.get('cookie') ?? '',
            ),
          }
        : {}),
    });

    return next(clonedReq);
  }

  return next(req);
}

export function isOwnApiRequest(requestUrl: string, apiUrl: string): boolean {
  try {
    const api = new URL(apiUrl);
    const request = new URL(requestUrl, environment.baseUrl);
    const basePath = api.pathname.replace(/\/$/, '');
    const authPath = `${basePath}/api/auth`;
    const isApiPath =
      request.pathname === basePath ||
      request.pathname.startsWith(`${basePath}/`);
    const isAuthPath =
      request.pathname === authPath ||
      request.pathname.startsWith(`${authPath}/`);
    return request.origin === api.origin && isApiPath && !isAuthPath;
  } catch {
    return false;
  }
}
