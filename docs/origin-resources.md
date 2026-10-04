# Origin resource usage

Open a deployment's **Resources** page from its detail page. Breadcrumbs lead back to the deployment and project. Project viewers, developers, project admins, and instance admins can inspect usage under the same access rules as logs.

The page displays current CPU and RAM usage for the origin container. Static sites report their nginx origin usage. Container-image deployments report their application container usage. Proxy usage is separate and is not included.

CPU percentage uses the difference between Docker's consecutive container and system CPU counters. A value of 100% represents one CPU core, so a container using several cores can exceed 100%. RAM usage subtracts inactive file cache where Docker supplies that counter. The page also shows the memory limit and the sample time. These conventions follow [Docker's resource statistics documentation](https://docs.docker.com/reference/cli/docker/container/stats/).

The browser requests a new sample every two seconds while the page is active. Refreshing stops when the page closes and pauses in the background. The API reads a fresh Docker stats sample on demand; it does not store resource history or run another background collector.

Stopped or missing origins show an unavailable state. Missing counters and Docker failures also show unavailable usage. They do not display fabricated zero measurements. A failed request shows an error and a retry control.

The API checks project access and deployment membership, then verifies the origin's instance, project, deployment, role, and management labels before reading stats. Reading usage does not change containers, networking, or proxy configuration.
