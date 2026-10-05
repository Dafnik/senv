import type { ActionHost } from '../controller.ts';

import type { ActionTools } from './index.ts';
export function registerHistory(this: ActionHost, tools: ActionTools) {
  const { add, selected, adminOnly } = tools;

  if (selected)
    add(
      'Remove deployment history permanently',
      () =>
        this.mutation(
          'Remove deployment history',
          (v) =>
            v.client.deployments.removeHistory.mutate({
              projectId: this.project!.id,
              deploymentId: String(selected.data.deploymentId),
            }),
          [
            `Deployment: ${selected.data.deploymentId}`,
            'Only deleted/cleaned deployments with no retained artifact can be removed. This deletes their history record permanently.',
          ],
        ),
      adminOnly,
    );
}
