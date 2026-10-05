import { createHash } from 'node:crypto';
import { deploymentStorageRoot } from '../storage/storage';

export function deploymentInstanceId(root = deploymentStorageRoot()): string {
  return (
    process.env['SENV_INSTANCE_ID'] ??
    `senv-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`
  );
}
