# Security policy

## Reporting a vulnerability

Please report security issues privately. Don't open a public issue. In this repository, go to the
**Security** tab and choose **Report a vulnerability**, which opens a private advisory that only the
maintainers can see.

Include what you found, the steps to reproduce it and the impact you expect. We'll confirm we
received it, keep you updated while we investigate, and credit you in the advisory if you'd like.

## Supported versions

Security fixes are made on the `main` branch, which is what gets deployed.

## Scope

In scope: the web app, the worker, their Docker images and the configuration in this repository.
Out of scope: findings that need a compromised account or device, denial of service through
traffic volume, and reports from automated scanners that come without a working proof of concept.

The main controls are summarized in the [README](README.md#security) and described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).
