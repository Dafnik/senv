import { linkProject } from '../services/link.ts';
import { Command } from 'commander';
import { context } from '../api/client.ts';
import { confirm, output } from '../output.ts';

export function projectCommands(program: Command) {
  const projects = program.command('projects');
  projects.command('list').action(async (_options, command: Command) => {
    const { client } = await context(command);
    const rows = [];
    let cursor: { createdAt: number; id: string } | undefined;
    do {
      const page = await client.projects.list.query({ cursor, limit: 100 });
      rows.push(...page.projects);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    output(rows, command);
  });
  projects.command('show').action(async (_options, command: Command) => {
    const value = await context(command);
    output(await value.client.cli.project.query({ project: await value.project() }), command);
  });
  projects
    .command('create <name>')
    .option('--slug <slug>', 'Preview slug')
    .action(async (name: string, options, command: Command) =>
      output(
        await (
          await context(command)
        ).client.projects.create.mutate({ name, previewSlug: options.slug }),
        command,
      ),
    );
  projects.command('rename <name>').action(async (name: string, _options, command: Command) => {
    const value = await context(command);
    output(
      await value.client.projects.rename.mutate({ projectId: await value.project(), name }),
      command,
    );
  });
  projects
    .command('slug <slug>')
    .action(async (previewSlug: string, _options, command: Command) => {
      const value = await context(command);
      output(
        await value.client.projects.updatePreviewSlug.mutate({
          projectId: await value.project(),
          previewSlug,
        }),
        command,
      );
    });
  projects
    .command('link')
    .description('Save the selected instance and immutable project ID in the nearest .senv.json')
    .option('--replace', 'Replace the nearest existing link after confirmation')
    .action(async (options, command: Command) => {
      const value = await context(command);
      const projectId = await value.project();
      if (options.replace) await confirm(command, 'Replace the nearest existing project link?');
      output(await linkProject(value.name, projectId, options.replace), command);
    });
}
