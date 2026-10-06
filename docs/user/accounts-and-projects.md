# Accounts, projects, and invitations

## Set up an account

On a new instance, open the web app and complete `/setup` to create the first instance admin. Setup signs you in and verifies your email. Once an instance admin exists, setup closes. The last instance admin cannot be deleted or demoted.

Public registration is disabled. Instance admins create accounts under **Users → Add user** with a name and email. The recipient follows the signup email to choose a password; completion verifies the email and signs them in. Pending accounts cannot sign in before completing signup.

Signup links expire after one hour and can be used once. If delivery fails or the link expires, an instance admin can resend the signup email; resending invalidates the previous link. Administrators cannot choose another account's password.

## Recover access and manage sessions

Use **Profile** to request an email link to change your password, or `/forgot-password` to recover access. Instance admins can also send a password reset email from Users. Reset links expire after one hour and are single-use. Completing a reset revokes existing sessions, automation tokens, and outstanding CLI login authorizations. Pending accounts need their signup email instead.

Profile lists independent browser and CLI sessions and lets you revoke them. Browser logout leaves CLI sessions active. CLI login uses explicit browser approval rather than password entry in the terminal. See the [CLI guide](../../apps/cli/README.md#install-and-sign-in).

For CI, create a project-scoped automation token in **Profile → Automation tokens**. The secret appears once; save it in your CI secret store. Tokens default to 30 days; an empty lifetime means no expiry. Read access permits inspection, while manage access adds publication and deployment lifecycle/tag changes. Tokens cannot open shells, create projects, administer users, manage membership or registry credentials, or change settings. See [CI and unattended automation](../../apps/cli/README.md#ci-and-unattended-automation).

## Projects and roles

After signing in, start at `/projects`. A project groups deployments and access; your instance role is separate from your role in each project.

| Role              | Access                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Project viewer    | Inspect deployments, logs, resources, history, and uploaded artifacts.                                                       |
| Project developer | Viewer access plus publication, deployment lifecycle, tags, registry credentials, and runtime/deployment/proxy defaults.     |
| Project admin     | Developer access plus project identity, membership, invitations, retention/resource defaults, and permanent history removal. |
| Instance admin    | Authority across projects and accounts, plus instance upload, proxy, and log defaults.                                       |

Project links use the editable project slug. Changing it immediately retires old project and preview addresses, and another project can reuse it. The project's identity and records remain intact.

Project **Settings** manages identity and defaults for future deployments. Runtime secrets can be replaced or removed, but their saved values are never returned. Configuration and registry credential management use the web app. See [deployment configuration](deployments.md#configuration).

## Invite project members

A project admin invites an email address from the project's **Members** section, choosing viewer, developer, or admin. The recipient signs in with that address, verifies it if needed, and follows the invitation link to accept. An account signup email and a project invitation are separate: pending accounts must finish account setup before joining.

Project admins can cancel pending invitations and manage existing members. The CLI/TUI also supports membership and invitations, while account signup and password completion stay in the browser. See [teams and user administration](../../apps/cli/README.md#teams-and-user-administration).
