import {
  deploymentProxySchema,
  normalizedPathSchema,
  proxyExtensionKey,
  proxyPathKey,
  type DeploymentProxy,
} from '../../../../shared/deployments';

export type ProxySettings = DeploymentProxy;
export type ProxyRoute = DeploymentProxy['routes'][number];
export type CacheRule = DeploymentProxy['cacheRules'][number];

export function createNginxConfig(input: {
  deploymentId: string;
  origin: string;
  settings: ProxySettings;
  spaFallback: boolean;
}): string {
  const { deploymentId, origin, spaFallback } = input;
  const settings = deploymentProxySchema.parse(input.settings);
  const cachePathRules = settings.cacheRules.filter((rule) => rule.matcher === 'path');
  const cacheExtensions = settings.cacheRules.filter((rule) => rule.matcher === 'extension');
  const pathLocations = cachePathRules
    .slice()
    .sort((a, b) => b.value.length - a.value.length)
    .map((rule) => {
      const path = normalizePath(rule.value);
      return `    location ~ ${pathRegex(path)} {\n${proxyBlock(origin, rule.durationSeconds, spaFallback)}\n    }`;
    });
  const extensionLocations = cacheExtensions.map((rule) => {
    const extension = normalizeExtension(rule.value);
    return `    location ~* \\.${regexEscape(extension)}$ {\n${proxyBlock(origin, rule.durationSeconds, spaFallback)}\n    }`;
  });
  const routes = settings.routes
    .slice()
    .sort((a, b) => b.path.length - a.path.length)
    .map((route) => {
      const path = normalizePath(route.path);
      return routeLocation(path, route);
    });
  const gzip = settings.compression.enabled
    ? `    gzip on;\n    gzip_vary on;\n    gzip_proxied any;\n    gzip_types *;`
    : '    gzip off;';
  const compressionMap = !settings.compression.enabled
    ? 'map $uri $compression_disallowed { default 1; }'
    : settings.compression.endings.length === 0
      ? 'map $uri $compression_disallowed { default 0; }'
      : `map $uri $compression_disallowed {\n        default 1;\n${settings.compression.endings.map((ending) => `        ~*\\.${regexEscape(normalizeExtension(ending))}$ 0;`).join('\n')}\n    }`;
  return `worker_processes auto;
events { worker_connections 1024; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    map $http_upgrade $connection_upgrade { default upgrade; '' close; }
    map "$http_authorization:$http_cookie" $request_has_identity { default 1; ":" 0; }
    ${compressionMap.replaceAll('\n', '\n    ')}
    proxy_cache_path /var/cache/nginx/${safeToken(deploymentId)} keys_zone=deployment_cache:10m max_size=128m inactive=1h use_temp_path=off;
    server {
        listen 80;
        server_tokens off;
        ${gzip.replaceAll('\n', '\n        ')}
        proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_ssl_server_name on;
${routes.join('\n')}
${pathLocations.join('\n')}
${extensionLocations.join('\n')}
        location = /_senv_health/${safeToken(deploymentId)} {
            access_log off;
            return 200 "ok";
        }
        location / {
${proxyBlock(origin, null, spaFallback)}
        }
    }
}
`;

  function routeLocation(path: string, route: ProxyRoute): string {
    const target = normalizeTarget(route.target);
    const rewritePrefix = route.rewrite ?? target.basePath;
    const basePath = path === '/' ? '' : path.replace(/\/$/, '');
    const replacementPrefix = rewritePrefix ? proxyPathKey(rewritePrefix).replace(/\/+$/, '') : '';
    const replacement = replacementPrefix ? `${replacementPrefix}/$1` : '/$1';
    const rewrite = rewritePrefix
      ? `\n            rewrite ${basePath ? `^${regexEscape(basePath)}(?:/(.*))?$` : '^/(.*)$'} ${replacement} break;`
      : '';
    const timeouts = `\n            proxy_connect_timeout ${seconds(route.connectTimeoutSeconds, 3600)}s;\n            proxy_read_timeout ${seconds(route.readTimeoutSeconds, 3600)}s;`;
    return `        location ~ ${pathRegex(path)} {${rewrite}${timeouts}\n${proxyBlock(target.origin, null, false, target.authority)}\n        }`;
  }
}

function proxyBlock(
  upstream: string,
  cacheSeconds: number | null,
  spaFallback: boolean,
  host = '$host',
): string {
  const cache =
    cacheSeconds === null
      ? ''
      : `\n            proxy_buffering on;\n            proxy_cache deployment_cache;\n            proxy_cache_key "${'$'}scheme|${'$'}request_method|${'$'}host|${'$'}request_uri";\n            proxy_cache_valid 200 ${seconds(cacheSeconds, 604800)}s;\n            proxy_cache_bypass ${'$'}request_has_identity;\n            proxy_no_cache ${'$'}request_has_identity ${'$'}upstream_http_set_cookie;`;
  const tryFiles = spaFallback
    ? `\n            proxy_intercept_errors on;\n            error_page 404 =200 /index.html;`
    : '';
  return `            proxy_set_header Host ${host};
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            if ($compression_disallowed) { gzip off; }\n            proxy_pass ${upstream};${cache}${tryFiles}`;
}

function normalizeTarget(input: string): { origin: string; authority: string; basePath: string } {
  const url = new URL(input.includes('://') ? input : `http://${input}`);
  return {
    origin: `${url.protocol}//${url.host}`,
    authority: url.host,
    basePath: url.pathname === '/' ? '' : url.pathname,
  };
}

function normalizePath(path: string): string {
  return proxyPathKey(normalizedPathSchema.parse(path));
}
function pathRegex(path: string): string {
  const base = path.endsWith('/') ? path.slice(0, -1) : path;
  return base ? `^${regexEscape(base)}(?:/|$)` : '^/';
}
function normalizeExtension(extension: string): string {
  return proxyExtensionKey(extension);
}
function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function seconds(value: number, max = 86400): number {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`Timeout and cache durations must be whole seconds between 1 and ${max}.`);
  return value;
}
function safeToken(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid deployment identifier.');
  return value;
}
