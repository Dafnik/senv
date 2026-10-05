import { router } from '../../trpc/trpc';
import { projectCoreProcedures } from './project-core.procedures';
import { projectInvitationProcedures } from './project-invitations.procedures';
import { projectMemberProcedures } from './project-members.procedures';
import { projectSettingsProcedures } from './project-settings.procedures';

export const projectsRouter = router({
  ...projectCoreProcedures,
  ...projectSettingsProcedures,
  ...projectMemberProcedures,
  ...projectInvitationProcedures,
});
