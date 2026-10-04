# Projects and invitations

Open **Projects** in the sidebar to create a project. Names can contain 1 to 100
characters. The project list loads more projects as you scroll and only renders
the visible rows. Project IDs are immutable, 21-character Nano IDs using the alphabet
`acdefghjkmnpqrtuvwxy34679` to avoid look-alike characters.

Projects use Better Auth's organization plugin. Its organization ID and internal
slug are the project ID. The creator is an `admin`; `developer` and `viewer` are
separate project roles. All three can view their project and its members. Project admins can rename projects, invite users, change member roles, remove members, or cancel
invitations. Instance admins can view and manage all projects without membership.
They can invite a new admin or change an existing member's role, including when a
project has no members or admins. Removing a member revokes access to that project.
Developers can publish, start, stop, and delete deployments, assign tags, manage
registry credentials, and edit deployment settings that do not change project-admin
defaults. Viewers can inspect deployments, status, logs, and non-secret configuration;
they cannot publish or change project resources. Project admins can do everything
developers can and also manage project membership, invitations, the preview slug,
and retention/resource defaults. Project runtime variables, secrets, and registry credentials are managed in Settings. Pin deployments to protect them from timed cleanup. Instance deployment defaults have their own page in the admin sidebar. Project and deployment pages use the editable project slug, with dedicated detail, log, and resource routes and breadcrumbs. Changing the slug immediately breaks old preview and senv links. Deployment lists and details show configuration differences and expiry or protection. Settings changes apply to new deployments, including retention. Secret values and registry credentials are never
shown in deployment details. Instance admins can manage every project. Better Auth
prevents the last project admin from leaving or demoting themselves.

Run `pnpm db:migrate` to initialize the database before starting a fresh installation.

Invitation emails link to `/invitations/:invitationId`. The recipient signs in
using the invited email address and accepts the invitation. **Use another account**
preserves the invitation while signing out and returning to login. Users who completed
account signup are already verified. Older unverified accounts can still request
a verification email from the invitation page. That link expires after one hour
and returns to the same invitation. Knowing an
invitation ID is insufficient without a verified recipient account. Links are
single-use and expire after seven days. Inviting the same address again replaces
its pending invitation. Invalid replacement roles leave the existing link valid.
Expired or cancelled invitations cannot be accepted.

Project admins manage open invitations in a table with email search, sortable
columns, and server pagination. Accepted, canceled, rejected, and expired
invitations are excluded. The member table records the inviter's ID and name when
an invitation is accepted. Deleting that account clears the inviter ID but retains
the recorded name. The initial schema includes these fields.

### Email delivery

The API renders HTML and plain-text invitations with React Email and sends them
through Nodemailer. Outside development, configure:

- `SMTP_URL`, for example `smtps://username:password@smtp.example.com:465`.
- `EMAIL_FROM`, for example `senv <noreply@example.com>`.
- `APP_URL`, the public app origin used in invitation links.

Missing delivery configuration causes sending to fail instead of discarding the
email. After fixing delivery, invite the address again to issue a fresh link.

During local development (`NODE_ENV=development`), no email is sent. The temporary
`GET /api/notifications` endpoint returns `{ notifications: [...] }`, newest first,
with recipient, subject, rendered HTML, plain text, and timestamps, including
signup, password reset, and verification emails. Each entry includes a `previewUrl` linking to
`GET /notification/:id`, which displays the rendered email. The last 100 messages
are saved as HTML and JSON in `email-notifications/` beside the SQLite database
and survive API restarts. Older messages and their HTML previews are removed. This unauthenticated local
inbox contains invitation links; do not expose the development API publicly.
Both endpoints return 404 outside development.

References: [Better Auth organizations](https://better-auth.com/docs/plugins/organization)
and [React Email's Nodemailer integration](https://react.email/docs/integrations/nodemailer).
