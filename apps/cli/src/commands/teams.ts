import { userOperation } from '../services/users.ts';
import { decideInvitation } from '../services/invitations.ts';
import { Command } from 'commander';
import { authRequest, context } from '../api/client.ts';
import { confirm, integer, offset, output } from '../output.ts';
import { CliError } from '../errors.ts';
const projectRole = (value: string): 'viewer' | 'developer' | 'admin' => {
  if (!['viewer', 'developer', 'admin'].includes(value))
    throw new CliError('Choose viewer, developer, or admin.', 2);
  return value as 'viewer' | 'developer' | 'admin';
};

export function teamCommands(program: Command) {
  const members = program.command('members');
  members.command('list').action(async (_options, command: Command) => {
    const value = await context(command);
    output(
      (await value.client.projects.detail.query({ projectId: await value.project() })).members,
      command,
    );
  });
  members
    .command('role <id> <role>')
    .action(async (memberId: string, role: string, _options, command: Command) => {
      const value = await context(command);
      output(
        await value.client.projects.changeMemberRole.mutate({
          projectId: await value.project(),
          memberId,
          role: projectRole(role),
        }),
        command,
      );
    });
  members.command('remove <id>').action(async (memberId: string, _options, command: Command) => {
    await confirm(command, 'Remove this project member?');
    const value = await context(command);
    output(
      await value.client.projects.removeMember.mutate({
        projectId: await value.project(),
        memberId,
      }),
      command,
    );
  });
  const invitations = program.command('invitations');
  invitations
    .command('list')
    .option('--limit <count>', 'Page size', integer, 100)
    .option('--all', 'Read every page')
    .option('--offset <count>', 'Result offset', offset, 0)
    .action(async (options, command: Command) => {
      const value = await context(command);
      const invitations = [];
      let resultOffset = options.offset;
      let page;
      do {
        page = await value.client.projects.invitations.query({
          projectId: await value.project(),
          limit: options.limit,
          offset: resultOffset,
        });
        invitations.push(...page.invitations);
        resultOffset += page.invitations.length;
      } while (options.all && resultOffset < page.total && page.invitations.length);
      output(options.all ? invitations : page, command);
    });
  invitations
    .command('show <id>')
    .action(async (invitationId: string, _options, command: Command) =>
      output(
        await (await context(command)).client.projects.invitation.query({ invitationId }),
        command,
      ),
    );
  invitations
    .command('create <email>')
    .option('--role <role>', 'viewer, developer, or admin', 'viewer')
    .action(async (email: string, options, command: Command) => {
      const value = await context(command);
      output(
        await value.client.projects.invite.mutate({
          projectId: await value.project(),
          email,
          role: projectRole(options.role),
        }),
        command,
      );
    });
  invitations
    .command('cancel <id>')
    .action(async (invitationId: string, _options, command: Command) => {
      const value = await context(command);
      output(
        await value.client.projects.cancelInvitation.mutate({
          projectId: await value.project(),
          invitationId,
        }),
        command,
      );
    });
  for (const operation of ['accept', 'reject'] as const)
    invitations
      .command(`${operation} <id>`)
      .action(async (invitationId: string, _options, command: Command) => {
        const value = await context(command);
        output(await decideInvitation(value, invitationId, operation), command);
      });
}
export function userCommands(program: Command) {
  const users = program.command('users').description('Instance-admin user operations');
  users
    .command('list')
    .option('--limit <count>', 'Page size', integer, 100)
    .option('--offset <count>', 'Result offset', offset, 0)
    .action(async (options, command: Command) => {
      const value = await context(command);
      output(
        await authRequest(
          value.profile.apiUrl,
          `admin/list-users?limit=${options.limit}&offset=${Number(options.offset)}`,
          value.token,
        ),
        command,
      );
    });
  users.command('show <id>').action(async (userId: string, _options, command: Command) => {
    const value = await context(command);
    output(
      await authRequest(
        value.profile.apiUrl,
        `admin/get-user?id=${encodeURIComponent(userId)}`,
        value.token,
      ),
      command,
    );
  });
  users
    .command('create <name> <email>')
    .action(async (name: string, email: string, _options, command: Command) => {
      const value = await context(command);
      output(
        await userOperation(value, 'create', {
          name,
          email,
          role: 'user',
        }),
        command,
      );
    });
  users
    .command('role <id> <role>')
    .action(async (userId: string, role: string, _options, command: Command) => {
      if (!['user', 'admin'].includes(role)) throw new CliError('Choose user or admin.', 2);
      const value = await context(command);
      output(await userOperation(value, 'role', { userId, role }), command);
    });
  users.command('delete <id>').action(async (userId: string, _options, command: Command) => {
    await confirm(command, 'Delete this user?');
    const value = await context(command);
    output(await userOperation(value, 'delete', { userId }), command);
  });
  for (const [name, endpoint] of [
    ['resend-signup', 'account-signup/resend'],
    ['send-password-reset', 'account-password/admin-reset'],
  ])
    users.command(`${name} <id>`).action(async (userId: string, _options, command: Command) => {
      const value = await context(command);
      output(await authRequest(value.profile.apiUrl, endpoint!, value.token, { userId }), command);
    });
  program
    .command('instance')
    .command('stats')
    .action(async (_options, command: Command) =>
      output(await (await context(command)).client.admin.stats.query(), command),
    );
}
