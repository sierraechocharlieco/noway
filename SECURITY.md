# Security Policy

## Reporting a Vulnerability

Please report security issues privately through GitHub's vulnerability reporting:

1. Open the repository's **Security** tab at https://github.com/sierraechocharlieco/noway/security.
2. Click **Report a vulnerability** and describe the issue, including reproduction steps where possible.

Do not include sensitive details in public GitHub Issues.

This is an experimental, developer-mode-only project maintained on a best-effort basis. Reports are appreciated and will be reviewed, but there is no guaranteed response time or formal disclosure process.

## Scope

No Way! is a local guardrail for careful manual workflows, not a security boundary. Detection is heuristic and site-dependent, and the README documents that unknown or changed actions may pass through. Reports that a risky action was not detected on a particular site are useful, but they are bug reports rather than vulnerabilities — please file those as regular GitHub Issues without account-identifying details.

Vulnerability reports are most useful for issues such as:

- Ways a web page could read, modify, or exfiltrate stored rules or extension state.
- Ways a web page could abuse the extension's permissions or injected scripts.
- Flaws in the import/export handling that could lead to code execution or data exposure.
- Issues in the development harness that could affect users beyond their own machine.
