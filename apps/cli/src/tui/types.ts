import type { DetailBlock } from './detail-layout.ts';

export type Screen =
  | 'Projects'
  | 'Deployments'
  | 'History'
  | 'Members'
  | 'Invitations'
  | 'Account'
  | 'Sessions'
  | 'Automation tokens'
  | 'Users'
  | 'Instance statistics'
  | 'Instances';
export type DeploymentTab = 'Overview' | 'Addresses' | 'Logs' | 'Resources' | 'History';
export type Destination = 'Projects' | 'Account' | 'Administration' | 'Instances';
export const deploymentTabs: DeploymentTab[] = [
  'Overview',
  'Addresses',
  'Logs',
  'Resources',
  'History',
];
export type Row = {
  id: string;
  title: string;
  subtitle: string;
  lines: string[];
  data: Record<string, unknown>;
  document?: DetailBlock[];
};
export type Field = {
  key: string;
  label: string;
  value: string;
  choices?: string[];
  required?: boolean;
};
export type Action = { label: string; run: () => void; disabled?: string };
export type Modal =
  | { kind: 'menu'; title: string; actions: Action[]; index: number }
  | {
      kind: 'form';
      title: string;
      fields: Field[];
      index: number;
      review: boolean;
      error?: string;
      changed?: boolean;
      notice?: string[];
    }
  | { kind: 'confirm'; title: string; lines: string[]; index: number }
  | { kind: 'message'; title: string; lines: string[]; secret?: boolean }
  | { kind: 'login'; title: string; url: string; code: string; expiresAt: number };
export type State = {
  revision: number;
  screen: Screen;
  rows: Row[];
  selected: number;
  query: string;
  searching: boolean;
  focus: 'navigation' | 'tabs' | 'content';
  navigation: Destination[];
  screens: Screen[];
  navIndex: number;
  page: number;
  hasNext: boolean;
  loading: boolean;
  busy: boolean;
  status: string;
  error?: string;
  lastRefresh?: string;
  instance: string;
  account: string;
  project: string;
  projectId?: string;
  submittedDeploymentId?: string;
  detail?: Row;
  tab: DeploymentTab;
  scroll: number;
  follow: boolean;
  autoScroll: boolean;
  source: 'origin' | 'proxy';
  watch: boolean;
  deploymentFilter: string;
  historyEvent: string;
  historyActor: string;
  modal?: Modal;
  suspended: boolean;
};
