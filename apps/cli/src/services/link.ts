import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localProject } from '../profiles.ts';
import { CliError } from '../errors.ts';
export const nearestLink = () => localProject();
export async function linkProject(instance: string, projectId: string, replace = false) {
  const existing = await nearestLink();
  if (existing && existing.instance === instance && existing.projectId === projectId)
    return { instance, projectId, path: existing.path, kept: true };
  if (existing && !replace)
    throw new CliError(
      `Project link ${existing.path} already selects ${existing.instance}/${existing.projectId}. Keep it or pass --replace to replace that link.`,
      2,
    );
  const path = existing?.path ?? join(process.cwd(), '.senv.json');
  try {
    await writeFile(path, `${JSON.stringify({ instance, projectId }, null, 2)}\n`, {
      flag: existing && replace ? 'w' : 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new CliError(`Project link ${path} already exists. Inspect it before replacing.`, 2);
    throw error;
  }
  return { instance, projectId, path, kept: false };
}
