# Publishing and managing deployments

## Publish

Open a project's **Deployments** section to publish built website files or an existing web application container image. Project developers and admins can publish; viewers can inspect deployments. The instance must have working Docker and preview ingress configured by its operator.

For static sites, supply a built directory or a supported archive. Static uploads accept ZIP and TAR, including TAR compressed with gzip, zlib/deflate, raw deflate, Brotli, or Zstandard. ZIP supports stored and deflate entries. Uploaded and expanded content must each fit the instance upload limit. Archives containing unsafe paths, links, duplicate entries, or unsupported content are rejected.

For containers, supply an image and its HTTP port. Private images can reference an existing project registry credential, managed in the web app. Images must already contain the application; senv does not build them. Image tags are resolved to fixed digests when publishing.

Branch and commit metadata are optional and describe the supplied artifact. They do not trigger a source checkout, build, or deployment tag assignment. Every publication creates a new deployment, even for the same source revision. Retained static artifacts can be reused without uploading again.

The [CLI guide](../../apps/cli/README.md#publish-and-inspect) covers terminal publication and CI workflows.

## Configuration

Use project **Settings** to set runtime environment values and secrets, client-side routing fallback, repository metadata, health checks, and proxy/cache/compression defaults. Project admins also control origin resource limits and retention; instance admins control proxy allowances, upload limits, and log defaults.

Each publication captures its configuration. Later settings changes affect future publications; publish a replacement to change an existing deployment's configuration. Restarts retain the captured configuration. Secret values are never returned after saving.

Static sites with client-side routing can enable the fallback to `index.html` for requests that do not match a file. Explicit proxy routes override the default origin and bypass caching.

## Preview addresses and retention

Each deployment has its own preview address. A branch alias selects the newest healthy deployment by submission order. Developers and admins can assign or move project-scoped deployment tags to healthy deployments using the web app or CLI/TUI. Tags are senv labels with no Git integration.

Pin deployments that must survive automatic cleanup. Pinned deployments, current branch deployments, and deployments carrying tags are protected. Losing the final protection starts a fresh retention period. A current branch deployment remains protected even if it later becomes unhealthy.

Changing a project slug moves its preview addresses and immediately retires the previous links. Stopping a deployment retains its identity, artifact, and branch/tag selections. Developers and admins can restart it while its artifact remains available; stopping alone does not protect it from cleanup.

Deletion or automatic cleanup removes resources, artifacts no longer in use, and raw logs. Lifecycle events, source metadata, configuration summaries without secrets, and failure reasons remain in deployment history. Only project admins or instance admins can permanently remove that history.

## Inspect deployments

Deployment details provide health status, configuration summaries, addresses, logs, resources, and history. Origin health probes run inside the private deployment network. A separate preview check reports the public preview root's HTTP status or connection error, refreshing every 30 seconds or on request.

Origin and proxy logs use the deployment's captured rotation allowance. Resource history samples origin CPU and memory every 30 seconds and retains 20 minutes, even when nobody has the app open. Missing or stopped origins appear as gaps rather than zero usage. Removing a deployment clears its resource samples.

Personal users with project manage access can open an origin-container shell through the CLI/TUI. See the [shell guide](../../apps/cli/README.md#interactive-shells) for requirements and limits.

## Browse uploaded artifacts

Open the project **Artifacts** section to browse uploaded static artifacts used by deployments. Open an artifact to browse its folders with aggregate sizes. Select a file for its path, copy action, metadata, inline image, or Shiki code preview. Other file types offer a download. A shared Download menu on the artifact page and table offers ZIP and tar.gz. Code previews are limited to 256 KiB and image previews to 32 MiB; larger files remain downloadable. The artifact ID in deployment details links to this browser. Project viewers can browse and download artifacts. Source metadata is captured on upload, or on the first publication for older clients, and stays fixed when deployments reuse the artifact. Artifacts keep the existing deployment cleanup policy; container image contents are not included.
