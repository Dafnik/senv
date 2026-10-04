import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { DeploymentPreviewStatus } from '../../../../shared/deployments';

/** GET the public root without cookies or redirects; only response headers are needed. */
export function requestDeploymentPreview(
  previewUrl: string,
  timeoutMs = 5_000,
): Promise<DeploymentPreviewStatus> {
  const url = new URL(previewUrl);
  const start = performance.now();
  return new Promise((resolve) => {
    const finish = (statusCode: number | null, error: string | null) => {
      clearTimeout(deadline);
      resolve({
        url: previewUrl,
        statusCode,
        checkedAt: new Date(),
        responseTimeMs: Math.round(performance.now() - start),
        error,
      });
    };
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        headers: { accept: 'text/html', 'user-agent': 'senv-preview-check' },
        // Browsers resolve *.localhost to loopback, but Node's system DNS may not.
        ...(url.hostname.endsWith('.localhost')
          ? {
              family: 4,
              autoSelectFamily: false,
              lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4),
            }
          : {}),
      },
      (response) => {
        finish(response.statusCode ?? null, null);
        response.destroy();
      },
    );
    const deadline = setTimeout(() => {
      finish(null, `The preview did not respond within ${timeoutMs / 1_000} seconds.`);
      request.destroy();
    }, timeoutMs);
    request.once('error', (error: NodeJS.ErrnoException) => {
      const message =
        error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN'
          ? 'The preview hostname could not be resolved.'
          : error.code === 'ECONNREFUSED'
            ? 'The preview server refused the connection.'
            : error.code?.includes('CERT') || error.code?.includes('TLS')
              ? 'The preview TLS connection could not be verified.'
              : 'The preview could not be reached.';
      finish(null, message);
    });
    request.end();
  });
}
