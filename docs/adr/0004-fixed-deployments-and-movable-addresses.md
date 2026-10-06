---
status: accepted
---

# Snapshot deployment content and configuration and move named addresses

Every publish creates a separate deployment with fixed artifact content and captured runtime configuration, even when source metadata matches an earlier publication; container images are resolved to digests. Changes to environment values, secrets, HTTP settings, SPA behavior, CPU or memory limits, or cache, compression, and reverse-proxy settings require a new deployment. This preserves the meaning of an individual deployment during comparisons and restarts, at the cost of publishing replacements for configuration changes and retaining multiple versions until cleanup.

Branch aliases select healthy deployments using submission order, while developers and admins assign or move deployment tags through the web app or CLI/TUI. Restarting a stopped deployment preserves its identity and snapshot; publishing changed content or configuration creates a new identity.

A replacement can reuse a retained artifact without another upload. Removing the original deployment must not remove content still required by the replacement.
