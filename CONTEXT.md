# senv

senv means simple environment. It is a deployment and preview application that groups deployments and access within projects.

## Language

**Instance**:
A senv installation with its own accounts and projects.

**Instance admin**:
An account administrator for the instance, with authority over all projects, their administrators, static upload limits, proxy allowances, and log-size defaults.
_Avoid_: Global user-admin, owner

**Instance role**:
The account's single role in an instance, either user or admin. It is separate from project membership.

**Project**:
A named workspace with members and a permanent identity.
_Avoid_: Organization

**Project slug**:
A readable, editable project name used in preview addresses and senv project, deployment, and log routes. Changing it retires the old links immediately and allows reuse of the old slug without changing the project's identity.
_Avoid_: Project ID, display name, internal organization slug

**Project member**:
An account with a role in a particular project, either viewer, developer, or admin.

**Project admin**:
A project member who manages that project's settings, memberships, invitations, deployment retention, resource limits, deployments, and retained history.
_Avoid_: Owner, instance admin

**Project developer**:
A project member who can manage deployments, tags, registry credentials, and project proxy settings. They cannot manage membership, retention, resource limits, project name, project slug, or permanent history removal.
_Avoid_: Project admin

**Signup email**:
An invitation to complete a pending account by verifying its email address and choosing a password.
_Avoid_: Project invitation, password reset

**Project invitation**:
An offer to join one project with a specified project role, addressed to an account's email.
_Avoid_: Signup email

**Password reset email**:
A recovery link for an account that already has a password, allowing its recipient to choose a replacement.
_Avoid_: Signup email

### Deployments

**Deployment**:
A publication of fixed application content within a project, with its own identity and preview address. Publishing the same source revision again creates another deployment.
_Avoid_: Project

**Deployment ID**:
A permanent, 12-character readable lowercase identifier without a prefix, using the alphabet `abcdefghjkmnopqrstuvwxy2345679`, used in a deployment's preview address. Existing deployments retain their earlier identifiers and addresses.
_Avoid_: Project ID, deployment tag

**Static deployment**:
A deployment of built website files supplied as a directory or archive.
_Avoid_: Static environment

**Container deployment**:
A deployment of a container image that contains a web application.
_Avoid_: Database environment

**Pinned deployment**:
A deployment explicitly protected from automatic timed cleanup until it is unpinned. Unpinning starts a new retention period if no branch or tag protects it.
_Avoid_: Deployment lifetime, long-lived deployment

**Project resource limits**:
Admin-controlled CPU and memory defaults applied independently to each new deployment's origin container. Each deployment retains its captured limits when the project defaults change.
_Avoid_: Developer-controlled deployment settings

**Proxy allowance**:
Instance-admin-controlled CPU and memory defaults for each deployment's proxy container, separate from the origin's project resource limits. New deployments capture this allowance at publication.
_Avoid_: Pooled project budget

**Project proxy settings**:
The project's reverse-proxy, compression, and cache defaults managed by developers and admins and captured by each new deployment's proxy. Changes affect future deployments rather than modifying existing ones.
_Avoid_: Instance proxy policy, live deployment edits

**Client-side routing fallback**:
A project setting that serves `index.html` when a static-site request does not match a file. New static deployments capture the setting at publication.
_Avoid_: Per-deployment routing override

**Project health settings**:
The project's HTTP probe path, startup deadline, polling interval, probe timeout, and unhealthy threshold captured by new deployments. They are configured at project level rather than independently for a deployment.
_Avoid_: Per-deployment health overrides

**Proxy route**:
A project rule that forwards matching requests to a configured HTTP(S) destination with an optional path rewrite, overriding the default origin and bypassing caching. Deployments retain the routes captured at publication.
_Avoid_: Deployment tag, branch alias

**Cache rule**:
A project rule for caching eligible default-origin responses by request path or file type. Explicit proxy routes take precedence and bypass these rules.
_Avoid_: Proxy route

**Registry credential**:
A project-scoped credential that developers and admins can reuse when selecting a private registry image for deployment.
_Avoid_: Deployment tag, instance-wide credential

**Stateless web deployment**:
A static or container deployment whose persistent application data is not managed by senv. It can be pinned or unpinned.
_Avoid_: Stateless environment, temporary deployment

**Stateful environment**:
An environment containing persistent services and application data that senv manages, such as a database.
_Avoid_: Long-lived deployment

**Deployment artifact**:
The fixed prebuilt website files or container image content supplied for a deployment.
_Avoid_: Source repository

**Uploaded artifact**:
A fixed collection of prebuilt website files within a project, optionally associated with a branch or commit. Deployments can share it, and it follows their cleanup policy.
_Avoid_: Source repository, container image

**Project runtime settings**:
The project's environment variables and runtime secrets, captured by each new deployment. Changes affect future publications. Secret values are never returned after saving.
_Avoid_: Per-deployment runtime overrides

**Deployment configuration**:
The fixed runtime settings captured for a publication, including environment values, secrets, HTTP port, health check, SPA behavior, resource limits, and project proxy settings. Changing these settings requires a new deployment.
_Avoid_: Live-editable deployment settings

**Project repository**:
The optional, single source repository associated with a project. Commit and branch metadata refer to this repository when present; deployment tags have no repository integration.
_Avoid_: Deployment tag source

**Source metadata**:
Optional information associating a deployment or uploaded artifact with a Git commit or branch. It describes the claimed source of the supplied artifact and does not assign deployment tags.
_Avoid_: Deployment tag

**Deployment tag**:
A project-scoped senv label assigned in the UI to select one deployment for a named preview address, with no Git integration. A deployment can carry several tags; developers and admins can assign or move them to healthy targets, or remove them.
_Avoid_: Git tag, image tag, automatic release

**Branch alias**:
A named address for a branch's selected deployment, chosen when healthy. Earlier deployments retain their own addresses and their association with the branch until cleanup.
_Avoid_: Branch deployment ID

**Tagged deployment**:
A deployment currently carrying a user-assigned deployment tag and exempt from automatic timed cleanup. Formerly carrying a tag does not grant permanent protection.
_Avoid_: Latest deployment

**Current branch deployment**:
The deployment selected by a branch alias and exempt from automatic timed cleanup, even if it later becomes unhealthy. It must be healthy when selected, and submission order determines which successful deployment is newer.
_Avoid_: Project's latest deployment

**Deployment retention period**:
The project-configured time after which an unprotected deployment becomes eligible for automatic removal.
_Avoid_: Environment lifetime

**Cleanup protection**:
Exemption from automatic timed cleanup because a deployment is pinned, current for a branch, or carries a deployment tag. Losing the final protection starts a fresh retention period.
_Avoid_: Permanent retention

**Standalone deployment**:
A deployment with no branch association. If untagged, its automatic cleanup clock starts when it becomes ready.
_Avoid_: Current branch deployment

**Deployment history**:
The lifecycle events, source metadata, configuration summaries without secret values, and failure reasons retained after deletion or cleanup removes a deployment's resources, artifact, and raw logs. Project and deployment views share one history API with search, filters, sorting, and pagination. Only project admins can permanently remove this record.
_Avoid_: Running deployment

**Stopped deployment**:
A deployment deliberately taken out of service while retaining its artifact, identity, and branch or tag selections. Developers and admins can restart it using the same identity, unless cleanup has removed its artifact.
_Avoid_: Deleted deployment
