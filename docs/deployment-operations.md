# Deployment operations

This continues [the deployment feature specification](deployment-feature.md).

## Readiness, stopping, and recovery

Health checks are configured in project settings, not per deployment, and captured at publication. The HTTP path defaults to `/`, startup deadline to 60 seconds, polling interval to five seconds, and per-probe timeout to three seconds. The first 2xx response marks readiness. After readiness, three consecutive failed probes mark the deployment unhealthy and one successful probe restores healthy status. Neither event moves branch or tag selections.

Check the owned origin and proxy rather than accepting a cached response or a response from an external proxy route as proof of readiness. For static deployments, validate the required root `index.html` and verify that the static-serving origin responds successfully. The owned proxy must also be running with valid configuration before the deployment becomes ready.

Manual stopping preserves the deployment's identity, retained artifact, branch selections, and tags, but makes its URLs unavailable. Developers and admins can restart it with the same snapshot and identity. Readiness gates its return to service. Manual deletion removes its containers, artifact, individual URL, and attached branch or tag selections. Neither operation automatically selects an older deployment.

After an API or Docker restart, senv reconciles deployment records with its own containers, restores deployments intended to run, and leaves explicitly stopped deployments stopped. Failed restoration must be visible rather than silently selecting another version.

## Retention and history

Pinning exempts a deployment from timed cleanup. Unpinning starts a fresh retention period if no branch or tag still protects it. Pinning does not prevent manual deletion.

Retention is a project setting controlled by admins, defaulting to seven days. A deployment is protected from timed cleanup while pinned, selected by any branch, or carrying any deployment tag. Protection remains if the selected deployment becomes unhealthy or is deliberately stopped. Protection does not prevent manual deletion.

| Event                                                                                            | Retention behavior                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| An untagged branch deployment is superseded and loses its final protection                       | Start a fresh retention period at supersession.                                                              |
| A deployment loses its final tag and is not selected by a branch                                 | Start a fresh retention period, regardless of its age.                                                       |
| Another branch or tag still selects the deployment                                               | Keep protection; do not start cleanup merely because one selection changed.                                  |
| An unprotected deployment becomes ready but is never selected, including a standalone deployment | Start its clock at readiness.                                                                                |
| A deployment fails before readiness                                                              | Start its unprotected clock at failure.                                                                      |
| An unprotected deployment is stopped                                                             | Stopping alone grants no protection and does not reset an existing clock.                                    |
| A project admin changes retention                                                                | Capture the new period on future deployments. Existing deployments keep their captured policy and deadlines. |
| An unprotected deployment reaches its deadline                                                   | Remove its containers and stored artifact, but keep its history record.                                      |

Manual deletion also preserves deployment history. Only project admins can permanently remove retained history records; instance admins retain their project-wide authority. Cleaned-up or deleted deployments cannot restart because their artifacts are no longer retained for them.

## Logs and diagnostic history

Expose bounded logs from both the proxy and origin while the deployment is retained. Default to three rotated files of 10 MiB per container. Instance admins control the log-size defaults.

On manual deletion or timed cleanup, remove raw deployment logs and captured deployment secret values. Project runtime secrets remain available for future deployments. Keep lifecycle events, source metadata, configuration summaries without secret values, and failure reasons in the deployment history record. Project-scoped registry credentials have their own lifecycle; removing a deployment does not remove credentials used by other deployments.

## Live origin resources

Each deployment has a dedicated [Resources page](origin-resources.md) beside its logs page. It shows CPU and RAM usage for the origin container, with breadcrumbs, active-page refreshes, and unavailable states for stopped or missing origins. Static deployments report their nginx origin.

## Implementation choices

- Slug suggestions lowercase the project name, normalize separators to hyphens, trim the label, and add a numeric suffix when necessary. Branch aliases use only the normalized branch name after `br-`, without a hash or ID suffix. Assigned aliases are stored independently of their current target.
- Paths are normalized absolute paths with segment boundaries. A route's rewrite is the replacement prefix; its target URL path can also supply that prefix. Connect and read timeouts default to 10 and 60 seconds. Cache durations are explicit whole seconds, up to seven days. Extension matchers ignore case and accept an optional leading dot. An empty compression allowlist includes extensionless responses.
- Publication reports queued, starting, healthy, unhealthy, stopped, failed, deleted, or cleaned state. Failed startup records a reason and retains bounded diagnostic logs. Upload errors leave no partially committed website. Non-secret publication drafts are stored per session and project in the browser; unsaved project secret values and file selections must be entered again after refresh.
- Static website trees are stored by a framed SHA-256 content hash and committed by atomic rename. Metadata and authorization remain project-scoped even when identical bytes share storage. Active deployment references and pending uploads protect those bytes. Unpublished uploads expire after 24 hours; deletion and retention cleanup release published content when its final reference disappears.
- Runtime secrets and captured registry authentication are encrypted with AES-256-GCM using a key derived from `BETTER_AUTH_SECRET`. Keep that secret stable across API restarts. Public summaries retain secret names without their values. Registry credentials remain independent project records.
- Preview routing uses an atomic Traefik file-provider snapshot and waits for the internal Traefik API to acknowledge route changes. Route mutations report failures; reversible changes restore their previous model state and reconcile the restored routes. Operator setup and local HTTP preview commands are in the [README](../README.md#docker).
- Deletion and timed cleanup persist their removal intent before retiring routes and removing containers. Startup resumes interrupted removals before normal reconciliation. Successful removal erases runtime secrets, logs, and artifact references while retaining history; a failed removal preserves the record and reports the failure. Pending removals are visible in the UI and cannot receive new selections.

## Technical constraints

- Localhost HTTPS needs locally trusted certificates or an explicit development HTTP policy. Let's Encrypt does not issue certificates for `localhost`. See [localhost guidance](https://letsencrypt.org/docs/certificates-for-localhost/).
- A TLS wildcard covers one hostname label. `*.preview.example.com` does not cover `ac3467.project.preview.example.com`; use per-project wildcard coverage or individual hostname certificates. See [RFC 9525, section 6.3](https://www.rfc-editor.org/rfc/rfc9525.html#section-6.3).
- Traefik's ACME wildcard issuance requires a DNS challenge, which affects operator DNS credentials. See [Traefik ACME documentation](https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/).
- DNS labels have a maximum of 63 octets. Validate individual generated labels and the complete domain name when configuring the preview base domain. See [RFC 1035, section 2.3.4](https://www.rfc-editor.org/rfc/rfc1035.html#section-2.3.4).
- Nginx supports upstream cache-control headers and excludes responses with `Set-Cookie` by default. Project cache settings must account for authenticated traffic and isolation across deployments and alias changes. See [Nginx proxy cache documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_valid).

## Later stateful environments

Keep persistent service identity and data ownership separate from web deployment replacement. A future database may survive many web publications and be reachable only within an environment's private network. The HTTP deployment routing requirement does not imply exposing databases through Nginx or Traefik.

Database provisioning, user-workload volumes, backup and restore, migrations, multi-service composition, and persistent-data lifecycle rules remain outside the first feature.

Deployment history records the initiating user’s name and ID at the time of each action, preserving attribution across account renames or deletion. Automated lifecycle events identify the system. Older history without recorded actors shows that the actor is unavailable. Pending deletions retain their initiating actor across recovery.
