import stringWidth from 'string-width';
import { deploymentTabs, type Destination, type Screen, type State } from './types.ts';

export const projectScreens: Screen[] = ['Deployments', 'History', 'Members', 'Invitations'];
const accountScreens: Screen[] = ['Account', 'Sessions', 'Automation tokens'];
const adminScreens: Screen[] = ['Users', 'Instance statistics'];

export function destination(screen: Screen): Destination {
  if (accountScreens.includes(screen)) return 'Account';
  if (adminScreens.includes(screen)) return 'Administration';
  if (screen === 'Instances') return 'Instances';
  return 'Projects';
}

export function destinations(screens: Screen[]): Destination[] {
  return [...new Set(screens.map(destination))];
}

export function sectionTabs(state: State): Screen[] {
  if (projectScreens.includes(state.screen) && !state.projectId) {
    return state.screen === 'Invitations' && state.screens.includes('Invitations')
      ? ['Invitations']
      : [];
  }
  const group = projectScreens.includes(state.screen)
    ? projectScreens
    : destination(state.screen) === 'Account'
      ? accountScreens
      : destination(state.screen) === 'Administration'
        ? adminScreens
        : [];
  return group.filter((screen) => state.screens.includes(screen));
}

export function activeTabs(state: State) {
  return state.detail && state.screen === 'Deployments' ? deploymentTabs : sectionTabs(state);
}

export function tabLabel(tab: string) {
  if (tab === 'Account') return 'Profile';
  if (tab === 'Instance statistics') return 'Statistics';
  return tab;
}

// Keep the active tab and as many neighboring tabs as the terminal can display.
export function visibleTabs(tabs: string[], active: string, width: number) {
  let start = Math.max(0, tabs.indexOf(active));
  let end = start + 1;
  const size = (from: number, to: number) =>
    stringWidth(
      tabs
        .slice(from, to)
        .map((tab) => ` ${tabLabel(tab)} `)
        .join(' '),
    ) +
    (from > 0 ? 4 : 0) +
    (to < tabs.length ? 4 : 0);
  while (end < tabs.length && size(start, end + 1) <= width) end++;
  while (start > 0 && size(start - 1, end) <= width) start--;
  return { tabs: tabs.slice(start, end), before: start > 0, after: end < tabs.length };
}
