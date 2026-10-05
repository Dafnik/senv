import type { ActionHost } from '../controller.ts';

import { CliError } from '../../errors.ts';

import type { ActionTools } from './index.ts';
export function registerDeployments(this: ActionHost, tools: ActionTools) {
  const { add, field, selected, unavailable, personalOnly } = tools;
  {
    add(
      'Publish deployment',
      () => {
        void this.preparePublication();
      },
      unavailable,
    );
    add('Filter by lifecycle status', () =>
      this.form(
        'Filter deployments',
        [
          field('status', 'Status', this.state.deploymentFilter || 'all', [
            'all',
            'queued',
            'starting',
            'healthy',
            'unhealthy',
            'failed',
            'stopped',
            'deleted',
            'cleaned',
          ]),
        ],
        async (v) => {
          this.update({
            deploymentFilter: v.status === 'all' ? '' : v.status,
            page: 0,
            rows: [],
          });
        },
        false,
      ),
    );
    const deployment = this.selectedDeployment ?? selected;
    if (!deployment) return;
    const input = { projectId: this.project!.id, deploymentId: deployment.id };
    const removed =
      Boolean(deployment.data.removalPending) ||
      ['deleted', 'cleaned'].includes(String(deployment.data.status));
    for (const operation of ['stop', 'restart', 'delete'] as const)
      add(
        `${operation[0]!.toUpperCase()}${operation.slice(1)} deployment`,
        () =>
          this.mutation(
            `${operation} deployment`,
            (v) => v.client.deployments[operation].mutate(input),
            operation === 'delete'
              ? [
                  `Deployment: ${deployment.id}`,
                  'The server will delete the deployment and its runtime. This cannot be undone.',
                ]
              : undefined,
          ),
        unavailable ?? (removed ? 'Deployment removed or removal pending' : undefined),
      );
    add(
      deployment.data.pinned ? 'Unpin deployment' : 'Pin deployment',
      () =>
        this.mutation('Change pinning', (v) =>
          v.client.deployments.setPinned.mutate({ ...input, pinned: !deployment.data.pinned }),
        ),
      unavailable ?? (removed ? 'Deployment removed or removal pending' : undefined),
    );
    add(
      'Assign / move preview tag',
      () => {
        void this.prepareTag(input);
      },
      unavailable ?? (removed ? 'Deployment removed' : undefined),
    );
    const tags = Array.isArray(deployment.data.tags) ? deployment.data.tags.map(String) : [];
    add(
      'Remove preview tag',
      () =>
        this.form(
          'Remove preview tag',
          [field('name', 'Tag', tags[0] ?? '', tags.length ? tags : undefined)],
          async (v, signal) => {
            await this.requestContext(signal).client.deployments.removeTag.mutate({
              projectId: input.projectId,
              name: v.name!,
            });
          },
        ),
      unavailable ?? (!tags.length ? 'No tags on this deployment' : undefined),
    );
    add('Check public preview status', () => {
      this.previewTarget = input;
      void this.refresh();
    });
    add('Open fixed preview URL', () => {
      void this.openUrl(String(deployment.data.previewUrl));
    });
    const addresses = deployment.data.addresses as
      | { branch?: string; tags?: { name: string; url: string }[] }
      | undefined;
    if (addresses?.branch)
      add('Open branch preview URL', () => {
        void this.openUrl(addresses.branch!);
      });
    for (const tag of addresses?.tags ?? [])
      add(`Open tag ${this.text(tag.name)}`, () => {
        void this.openUrl(tag.url);
      });
    add(
      'Open origin shell',
      () => {
        void this.perform(
          'Inspect shell target',
          async (signal) => {
            const target =
              await this.requestContext(signal).client.deployments.shellTarget.query(input);
            signal.throwIfAborted();
            this.form(
              'Open origin shell',
              [field('shell', 'Absolute shell path (optional)', '', undefined, false)],
              async (v, signal) => {
                if (v.shell && !v.shell.startsWith('/'))
                  throw new CliError('Shell path must be absolute.', 2);
                await this.shell(deployment.id, v.shell || undefined, signal);
              },
              false,
              [
                `Deployment ID: ${deployment.id}`,
                'Target: origin',
                `Configured user: ${this.text(target.configuredUser)}`,
                'Changes are temporary and disappear when the container is replaced.',
              ],
            );
          },
          false,
        );
      },
      personalOnly ??
        unavailable ??
        (!['healthy', 'unhealthy', 'starting'].includes(String(deployment.data.status))
          ? 'Origin must be running'
          : undefined),
    );
    add(
      'Publish using this retained source',
      () => {
        void this.preparePublication(deployment);
      },
      (unavailable ??
        (deployment.data.kind === 'static'
          ? !deployment.data.artifactId
          : !deployment.data.imageDigest))
        ? (unavailable ?? 'No retained source available')
        : undefined,
    );
  }
}
