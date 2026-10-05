import type { ActionHost } from '../controller.ts';
import type { Action, Field, Row } from '../types.ts';
import { deploymentTabs } from '../types.ts';
import { projectScreens } from '../navigation.ts';
import { row } from '../workspace.ts';

import { registerAccount } from './account.ts';
import { registerInstances } from './instances.ts';
import { registerProjects } from './projects.ts';
import { registerDeployments } from './deployments.ts';
import { registerHistory } from './history.ts';
import { registerMembers } from './members.ts';
import { registerInvitations } from './invitations.ts';
import { registerSessions } from './sessions.ts';
import { registerAutomationTokens } from './automation-tokens.ts';
import { registerUsers } from './users.ts';
export type ActionTools = {
  add: (label: string, run: () => void, disabled?: string) => void;
  field: (
    key: string,
    label: string,
    value?: string,
    choices?: string[],
    required?: boolean,
  ) => Field;
  selected?: Row;
  unavailable?: string;
  adminOnly?: string;
  personalOnly?: string;
};
export function buildActions(this: ActionHost) {
  if (this.state.busy) return;
  const selected = this.state.detail ?? this.selectedRow();
  const actions: Action[] = [];
  const add = (label: string, run: () => void, disabled?: string) =>
    actions.push({ label, run, disabled });
  const field = (
    key: string,
    label: string,
    value = '',
    choices?: string[],
    required = true,
  ): Field => ({ key, label, value, choices, required });
  if (
    this.state.status.includes('outcome may be unknown') ||
    this.state.status.includes('outcome is unknown')
  )
    add('Inspect refreshed server state', () => {
      this.update({ modal: undefined });
      void this.activate();
    });
  const unavailable = this.manage() ? undefined : 'Deployment manage permission required';
  const adminOnly = this.admin() ? undefined : 'Project admin required';
  const personalOnly = this.personal() ? undefined : 'Personal non-impersonated session required';
  if (this.state.detail && this.selectedDeployment) {
    for (const tab of deploymentTabs)
      add(tab, () => {
        void this.tab(deploymentTabs.indexOf(tab) - deploymentTabs.indexOf(this.state.tab));
      });
    if (this.state.tab === 'Logs') {
      add(this.state.follow ? 'Pause follow' : 'Follow logs', () => {
        this.update({ follow: !this.state.follow });
        void this.refresh();
      });
      add(`Switch log source to ${this.state.source === 'origin' ? 'proxy' : 'origin'}`, () => {
        this.resetLogs();
        this.afterSequence = undefined;
        this.olderCursor = undefined;
        this.update({
          source: this.state.source === 'origin' ? 'proxy' : 'origin',
          detail: row(this.selectedDeployment!.id, 'Logs', '', {}, []),
          scroll: 0,
        });
        void this.refresh();
      });
      add(
        'Load older logs',
        () => {
          void this.olderLogs();
        },
        this.olderCursor === null ? 'No older entries' : undefined,
      );
      add('Scroll to latest', () => this.jump(true));
    }
    if (this.state.tab === 'Resources') {
      add(this.state.watch ? 'Pause resource watch' : 'Watch resources', () => {
        this.update({ watch: !this.state.watch });
        void this.refresh();
      });
    }
  }
  if (
    this.state.screen === 'History' ||
    (this.selectedDeployment && this.state.tab === 'History')
  ) {
    add('Filter history events and actors', () =>
      this.form(
        'History filters',
        [
          field('event', 'Event (optional)', this.state.historyEvent, undefined, false),
          field(
            'actor',
            'Actor ID or system (optional)',
            this.state.historyActor,
            undefined,
            false,
          ),
        ],
        async (v) => {
          this.update({
            historyEvent: v.event!,
            historyActor: v.actor!,
            page: 0,
            rows: [],
            scroll: 0,
            ...(this.selectedDeployment && this.state.detail
              ? {
                  detail: {
                    ...this.state.detail,
                    data: { ...this.state.detail.data, offset: 0 },
                  },
                }
              : {}),
          });
        },
        false,
      ),
    );
  }
  const tools = { add, field, selected, unavailable, adminOnly, personalOnly };
  switch (this.state.screen) {
    case 'Account':
      registerAccount.call(this, tools);
      break;
    case 'Instances':
      registerInstances.call(this, tools);
      break;
    case 'Projects':
      registerProjects.call(this, tools);
      break;
    case 'Deployments':
      registerDeployments.call(this, tools);
      break;
    case 'History':
      registerHistory.call(this, tools);
      break;
    case 'Members':
      registerMembers.call(this, tools);
      break;
    case 'Invitations':
      registerInvitations.call(this, tools);
      break;
    case 'Sessions':
      registerSessions.call(this, tools);
      break;
    case 'Automation tokens':
      registerAutomationTokens.call(this, tools);
      break;
    case 'Users':
      registerUsers.call(this, tools);
      break;
    case 'Instance statistics':
      break;
  }
  if (
    this.project &&
    (this.state.screen === 'Projects' || projectScreens.includes(this.state.screen))
  ) {
    add(
      'Rename current project',
      () =>
        this.form(
          'Rename project',
          [field('name', 'Project name', this.project!.name)],
          async (v, signal) => {
            await this.requestContext(signal).client.projects.rename.mutate({
              projectId: this.project!.id,
              name: v.name!,
            });
            this.project = { ...this.project!, name: v.name! };
            this.update({ project: v.name });
          },
        ),
      adminOnly,
    );
    add(
      'Change current project preview slug',
      () =>
        this.form(
          'Change preview slug (preview URLs will change)',
          [field('slug', 'Preview slug', this.project!.previewSlug)],
          async (v, signal) => {
            await this.requestContext(signal).client.projects.updatePreviewSlug.mutate({
              projectId: this.project!.id,
              previewSlug: v.slug!,
            });
            this.project = { ...this.project!, previewSlug: v.slug! };
          },
        ),
      adminOnly,
    );
    add('Link working directory to current project', () => {
      void this.prepareLink();
    });
  }
  if (this.state.hasNext || this.state.detail?.data.hasNext)
    add('Next page', () => {
      void this.page(1);
    });
  if (this.state.page > 0 || Number(this.state.detail?.data.offset ?? 0) > 0)
    add('Previous page', () => {
      void this.page(-1);
    });
  add('Refresh', () => {
    void this.refresh();
  });
  add('Switch instance', () => this.navigate('Instances'));
  if (this.access) add('Select project', () => this.navigate('Projects'));
  this.update({
    modal: { kind: 'menu', title: `${this.state.screen} actions`, actions, index: 0 },
  });
}
