import { dirname, resolve } from 'node:path';

/** Directory shared by uploaded artifacts and deployment runtime state. */
export function deploymentStorageRoot(): string {
  if (process.env['DEPLOYMENT_STORAGE_DIR']) return resolve(process.env['DEPLOYMENT_STORAGE_DIR']);
  const databaseUrl = process.env['DATABASE_URL'] ?? 'file:./data/senv.sqlite';
  const filePath = databaseUrl.startsWith('file:') ? databaseUrl.slice(5) : './data/senv.sqlite';
  return resolve(dirname(filePath), 'deployments');
}
