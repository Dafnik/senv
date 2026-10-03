---
status: accepted
---

# Accept prebuilt artifacts for stateless web deployments first

senv's first deployment feature accepts built static artifacts or existing web application images with supplied Git metadata; it does not clone repositories or build applications. The first scope is stateless web deployments of either short or long lifetime, while stateful environments containing persistent services such as databases remain later scope. This puts artifact production outside senv and separates deployment lifetime from persistence, at the cost of requiring users or their build systems to produce artifacts and supply the source association.

Git metadata is optional. Submission is through the UI only, and the API controls one local Docker host directly for a trusted team's self-hosted installation. CI submission APIs, remote hosts, and a separate execution worker are deferred; the operator supplies the preview domain, DNS, and TLS configuration.
