# Ketos Security Policy

Ketos is an active open-source alpha. Security reports are welcome, but the
project does not currently claim an independent security audit, certification,
or production-readiness guarantee.

## Report a vulnerability

Do not disclose a suspected vulnerability, exploit, credential, or sensitive
user data in a public issue.

Use this repository's
[GitHub private vulnerability reporting](https://github.com/factor241/Ketos/security/advisories/new)
form. It creates a private draft security advisory that can be discussed with
the repository maintainer without exposing the report publicly.

Include, when available:

- the affected revision or Ketos version;
- the affected component, API, or workflow path;
- reproduction steps or a minimal proof of concept;
- the expected and observed behavior;
- potential impact and required preconditions;
- suggested mitigation or relevant references.

Remove unrelated secrets and personal information from logs or examples before
submitting them.

## What happens next

The maintainer will evaluate the report, reproduce it when possible, determine
the affected scope, and coordinate a fix and disclosure path through the private
advisory. Response and remediation times depend on severity, reproducibility,
and maintainer availability; no fixed service-level agreement is currently
offered.

Please keep the report private until a coordinated disclosure is agreed or the
maintainer closes it as not applicable.

## Supported scope

The current public `main` branch is the primary development line. The
repository does not currently publish a separately supported long-term release
line.

Reports may cover the application, KFX, extension loading, authentication and
authorization boundaries, workflow execution, persistence, or repository-owned
developer tooling. Vulnerabilities in a third-party service or dependency may
need to be reported to its own maintainer as well.

## Security expectations for users

Workflows can execute components and may call external model, data, storage, or
tool services. Review component code, dependency versions, credentials,
network access, and data-handling behavior for your environment before using
Ketos with sensitive information or in production.
