import { waitForPublication } from '../services/publication-wait.ts';
import { terminalText } from '../tui/safety.ts';
import { Command } from 'commander';
import { context } from '../api/client.ts';
import { publish } from '../services/publication.ts';
import { withAddresses } from '../api/addresses.ts';
import { CliError } from '../errors.ts';
import { confirm, delay, integer, offset, output } from '../output.ts';

export function deploymentCommands(program: Command) {
  const deployments = program.command('deployments');
  deployments.command('list').action(async (_options, command: Command) => {
    const value = await context(command);
    output(
      (
        await value.client.deployments.list.query({ projectId: await value.project() })
      ).deployments.map(withAddresses),
      command,
    );
  });
  deployments
    .command('show <id>')
    .action(async (deploymentId: string, _options, command: Command) => {
      const value = await context(command);
      output(
        withAddresses(
          await value.client.deployments.detail.query({
            projectId: await value.project(),
            deploymentId,
          }),
        ),
        command,
      );
    });
  deployments
    .command('publish [path]')
    .option('--image <image>', 'Container image tag or digest')
    .option('--reuse <id>', 'Reuse a retained deployment artifact/image')
    .option('--kind <kind>', 'Override retained source kind: static or container')
    .option('--registry-credential <id>', 'Existing registry credential ID')
    .option('--port <port>', 'Application port (default: retained port or 80)', integer)
    .option('--pin', 'Pin against retention')
    .option('--branch <branch>')
    .option('--commit <commit>')
    .option('--wait', 'Wait for a healthy deployment')
    .option('--timeout <seconds>', 'Wait timeout', integer, 300)
    .action(async (path: string | undefined, options, command: Command) => {
      const value = await context(command);
      const projectId = await value.project();
      const result = await publish(value, projectId, path, options);
      if (!options.wait) {
        output(withAddresses(result), command);
        return;
      }
      process.stderr.write(`Deployment ${result.id} submitted. Waiting for publication.\n`);
      let outcome;
      try {
        outcome = await waitForPublication(value, projectId, result.id, options.timeout);
      } catch (error) {
        output({ id: result.id, status: 'unknown' }, command);
        throw error;
      }
      if (outcome.status === 'timeout') {
        output(outcome, command);
        throw new CliError(
          `Timed out waiting for ${result.id}. Inspect it with deployments show; do not republish automatically.`,
        );
      }
      output(
        withAddresses(
          await value.client.deployments.detail.query({ projectId, deploymentId: result.id }),
        ),
        command,
      );
      if (outcome.status !== 'healthy')
        throw new CliError(`Deployment ${result.id} ended with status ${outcome.status}.`);
    });
  for (const operation of ['stop', 'restart', 'delete'] as const)
    deployments
      .command(`${operation} <id>`)
      .action(async (deploymentId: string, _options, command: Command) => {
        if (operation === 'delete') await confirm(command, 'Delete this deployment?');
        const value = await context(command);
        output(
          await value.client.deployments[operation].mutate({
            projectId: await value.project(),
            deploymentId,
          }),
          command,
        );
      });
  for (const operation of ['pin', 'unpin'])
    deployments
      .command(`${operation} <id>`)
      .action(async (deploymentId: string, _options, command: Command) => {
        const value = await context(command);
        output(
          await value.client.deployments.setPinned.mutate({
            projectId: await value.project(),
            deploymentId,
            pinned: operation === 'pin',
          }),
          command,
        );
      });
  const tags = deployments.command('tags');
  tags
    .command('set <name> <id>')
    .action(async (name: string, deploymentId: string, _options, command: Command) => {
      const value = await context(command);
      output(
        await value.client.deployments.assignTag.mutate({
          projectId: await value.project(),
          deploymentId,
          name,
        }),
        command,
      );
    });
  tags.command('remove <name>').action(async (name: string, _options, command: Command) => {
    const value = await context(command);
    output(
      await value.client.deployments.removeTag.mutate({ projectId: await value.project(), name }),
      command,
    );
  });
  deployments
    .command('logs <id>')
    .option('--source <source>', 'origin or proxy', 'origin')
    .option('--follow')
    .option('--limit <count>', 'Initial log chunks/page size (1 to 500)', integer, 100)
    .action(async (deploymentId: string, options, command: Command) => {
      if (!['origin', 'proxy'].includes(options.source))
        throw new CliError('Log source must be origin or proxy.', 2);
      const value = await context(command);
      const projectId = await value.project();
      let afterSequence: number | undefined;
      let gapCursor: number | undefined;
      do {
        const page = await value.client.deployments.logsForward.query({
          projectId,
          deploymentId,
          source: options.source,
          limit: options.limit,
          afterSequence,
        });
        if (page.retentionGap && gapCursor !== afterSequence) {
          gapCursor = afterSequence;
          process.stderr.write('Older log entries expired before they could be read.\n');
          if (options.follow && command.optsWithGlobals().json)
            output({ type: 'gap', afterSequence }, command);
        }
        if (!options.follow && command.optsWithGlobals().json) {
          output(page, command);
          break;
        }
        for (const entry of page.logs) {
          if (command.optsWithGlobals().json) output(entry, command);
          else
            process.stdout.write(
              `${terminalText(entry.content)}${entry.content.endsWith('\n') ? '' : '\n'}`,
            );
        }
        afterSequence = page.afterSequence;
        if (!options.follow) break;
        if (!page.hasMore) await delay(1000);
      } while (options.follow);
    });
  deployments
    .command('resources <id>')
    .option('--history')
    .option('--watch')
    .action(async (deploymentId: string, options, command: Command) => {
      const value = await context(command);
      const input = { projectId: await value.project(), deploymentId };
      do {
        output(
          options.history
            ? await value.client.deployments.resourceHistory.query(input)
            : await value.client.deployments.resources.query(input),
          command,
        );
        if (!options.watch) break;
        await delay(5000);
      } while (options.watch);
    });
  deployments
    .command('preview-status <id>')
    .action(async (deploymentId: string, _options, command: Command) => {
      const value = await context(command);
      output(
        await value.client.deployments.previewStatus.query({
          projectId: await value.project(),
          deploymentId,
        }),
        command,
      );
    });
  const history = deployments
    .command('history')
    .alias('audit')
    .option('--deployment <id>')
    .option('--all', 'Read every history page')
    .option('--offset <count>', 'Result offset', offset, 0)
    .option('--limit <count>', 'History count', integer, 100)
    .action(async (options, command: Command) => {
      const value = await context(command);
      const entries = [];
      let resultOffset = options.offset;
      let page;
      do {
        page = await value.client.deployments.history.query({
          projectId: await value.project(),
          limit: options.limit,
          deploymentId: options.deployment,
          offset: resultOffset,
        });
        entries.push(...page.entries);
        resultOffset += page.entries.length;
      } while (options.all && resultOffset < page.total && page.entries.length);
      output(options.all ? entries : page, command);
    });
  history
    .command('remove <id>')
    .action(async (deploymentId: string, _options, command: Command) => {
      await confirm(command, 'Permanently remove this deployment history?');
      const value = await context(command);
      output(
        await value.client.deployments.removeHistory.mutate({
          projectId: await value.project(),
          deploymentId,
        }),
        command,
      );
    });
}
