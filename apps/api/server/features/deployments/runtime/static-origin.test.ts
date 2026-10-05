import { expect, test } from 'vite-plus/test';
import { createStaticOriginNginxConfig } from './runtime';

test('static origin serves a root index and returns 404 for missing files', () => {
  const config = createStaticOriginNginxConfig(80, '/var/lib/senv/deployments/artifacts/abc');
  expect(config).toContain('index index.html;');
  expect(config).toContain('try_files $uri $uri/ =404;');
});
