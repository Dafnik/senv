export type ShellReason =
  | 'idle_timeout'
  | 'max_lifetime'
  | 'heartbeat_timeout'
  | 'session_revoked'
  | 'permission_lost'
  | 'deployment_stopped'
  | 'container_replaced'
  | 'docker_error'
  | 'shutdown';
export type ShellSelector = {
  userId?: string;
  sessionId?: string;
  deploymentId?: string;
  projectId?: string;
};
type Connection = Required<ShellSelector> & { close: (reason: ShellReason) => Promise<void> };
export const shellConnections = new Map<string, Connection>();
const grantInvalidators = new Set<(selector: ShellSelector) => void>();
export function registerGrantInvalidator(callback: (selector: ShellSelector) => void) {
  grantInvalidators.add(callback);
}
export function matchesShell(value: ShellSelector, selector: ShellSelector) {
  return Object.entries(selector).every(
    ([key, expected]) => value[key as keyof ShellSelector] === expected,
  );
}
export async function closeShells(selector: ShellSelector, reason: ShellReason) {
  for (const callback of grantInvalidators) callback(selector);
  await Promise.allSettled(
    [...shellConnections.values()]
      .filter((value) => matchesShell(value, selector))
      .map((value) => value.close(reason)),
  );
}
