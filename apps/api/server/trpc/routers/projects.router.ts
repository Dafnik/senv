import { router } from '../trpc';
import { projectCoreProcedures } from './project-core.procedures';
import { projectSettingsProcedures } from './project-settings.procedures';
import { projectMemberProcedures } from './project-members.procedures';
import { projectInvitationProcedures } from './project-invitations.procedures';

export const projectsRouter = router({
  ...projectCoreProcedures,
  ...projectSettingsProcedures,
  ...projectMemberProcedures,
  ...projectInvitationProcedures,
});
