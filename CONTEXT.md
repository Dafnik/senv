# senv

senv manages access to projects within an instance.

## Language

**Instance**:
A senv installation with its own accounts and projects.

**Instance admin**:
An account administrator for the instance, with authority over all projects and their administrators.
_Avoid_: Global user-admin, owner

**Instance role**:
The account's single role in an instance, either user or admin. It is separate from project membership.

**Project**:
A named workspace with members and a permanent identity.
_Avoid_: Organization

**Project member**:
An account with a role in a particular project, either viewer, developer, or admin.

**Project admin**:
A project member who manages that project's name, memberships, and invitations.
_Avoid_: Owner, instance admin

**Signup email**:
An invitation to complete a pending account by verifying its email address and choosing a password.
_Avoid_: Project invitation, password reset

**Project invitation**:
An offer to join one project with a specified project role, addressed to an account's email.
_Avoid_: Signup email

**Password reset email**:
A recovery link for an account that already has a password, allowing its recipient to choose a replacement.
_Avoid_: Signup email
