# Release Checklist

Use this checklist before the first public MIT release.

## Repository

- Publish from a fresh public repository or a clean squashed initial public commit.
- Do not publish the current private history with local machine author emails or old path churn.
- Confirm `.harness/*` remains ignored and only `.harness/.gitkeep` is tracked.
- Confirm icons and other assets are owned by Sierra Echo Charlie or are otherwise safe to publish under this repository's MIT licence.
- Confirm no canonical repository URL is referenced until public hosting is decided.
- Confirm the README prominently states that this is a vibe-coded experiment, developer-mode only, not a production release, and not a complete safety boundary.

## Validation

- Load the repository root as an unpacked extension in Chrome developer mode.
- Run JavaScript syntax checks:

```sh
node --check background/service_worker.js
node --check content/guard-main.js
node --check content/guard-controller.js
node --check popup/popup.js
node --check options/rules.js
node --check tools/action-monitor.mjs
node --check tools/harness.mjs
node --check tools/install-chrome-for-testing.mjs
node --check tools/module-scout.js
node --check tools/print-scout-snippet.mjs
```

- Smoke test with a clean profile:

```sh
node tools/harness.mjs --url https://example.com/ --no-profile-source
```

- Grant site access, toggle Training mode, toggle Protection, create a learned rule, export/import rules, and confirm mode and rule changes update already-open same-origin tabs without requiring a reload.

## GitHub Setup

- Enable GitHub Issues.
- Enable private vulnerability reporting if available.
- Confirm the syntax-check workflow passes.
- Tag the release after the public repository contents are final.
