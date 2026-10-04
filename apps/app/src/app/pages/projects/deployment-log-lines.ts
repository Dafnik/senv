import type { DeploymentLogPage } from '@senv/api/shared/deployments';
export type DeploymentLogLine = { id: string; text: string };

/** Keeps chronological order while splitting multiline records into fixed-height rows. */
export function deploymentLogLines(
  pages: DeploymentLogPage[],
): DeploymentLogLine[] {
  const seen = new Set<string>();
  return [...pages].reverse().flatMap((page) =>
    page.logs.flatMap((row) => {
      if (seen.has(row.id)) return [];
      seen.add(row.id);
      const date = new Date(row.createdAt);
      const timestamp = Number.isNaN(date.getTime())
        ? ''
        : `[${date.toLocaleString()}] `;
      const lines = row.content.split(/\r?\n/);
      if (lines.length > 1 && lines.at(-1) === '') lines.pop();
      return lines.map((text, index) => ({
        id: `${row.id}:${index}`,
        text: `${index === 0 ? timestamp : ''}${text}`,
      }));
    }),
  );
}
