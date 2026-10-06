---
status: accepted
---

# Route deployment traffic through Traefik and Nginx

senv places Traefik at the entry point for TLS and gives each deployment a proxy Nginx container ahead of a separate static-serving Nginx or application container. Proxy settings are captured at publication and remain fixed for that deployment; static-serving containers mount the uploaded website files. This provides a common serving architecture while isolating each deployment's policy version and lifecycle, at the cost of two containers per deployment and an additional proxy hop compared with routing Traefik directly to the origin container.

Shared proxy Nginx containers per project or instance, and combining static serving with the policy proxy in one container, were considered. The chosen shape keeps the policy proxy separate and allocates it per deployment. See the [deployment guide](../user/deployments.md#configuration) for captured routing configuration.

Developers and project admins edit reverse-proxy, compression, and cache defaults through a validated project-settings form. Each new deployment captures those defaults, so existing deployments can retain an earlier policy version. There is no instance-wide proxy-policy editor or live update of existing deployment proxies.
