# Contributing

Thanks for helping improve No Way!

This project is being open sourced as part of an experiment series about vibe coding and local safety tooling. It is intentionally small for the first release: no build step, no bundled dependencies, and developer-mode Chrome extension loading only.

No Way! is not a production safety product. Contributions are most useful when they make the experiment clearer, improve reproducible detection behaviour, or document concrete safety caveats.

## Reporting Issues

Use GitHub Issues for bugs, support questions, and feature requests once the repository is public. Reports should focus on reproducible behaviour and safety gaps rather than production support expectations.

Good bug reports include:

- Chrome version and operating system.
- The target site origin.
- Whether Training mode, Protection mode, and allow-once protection were enabled.
- The rule export if it is safe to share.
- Clear reproduction steps.

Do not post sensitive OSINT targets, account details, cookies, private profile data, or vulnerability details in public issues.

## Development Setup

Load the repository root as an unpacked extension:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository root.

The local harness is optional:

```sh
node tools/harness.mjs --url https://example.com/ --no-profile-source
```

The harness installs Chrome for Testing into `.harness/chrome-for-testing` on first use when no compatible binary is found.

Do not commit local Chrome profiles, downloaded browsers, account state, or other files under `.harness/`.

## Checks

Run syntax checks for edited JavaScript:

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

Use the harness for browser-level verification when changing content scripts, popup behaviour, rule storage, permission handling, or starter rules.

## Implementation Guidelines

- Keep site access per origin; do not request broad host access up front.
- Keep detection local. Do not add remote or on-device model-based detection without prior discussion.
- Prefer stable selectors and accessible metadata over brittle classes or positional selectors.
- Preserve rule changes taking effect in already-open same-origin tabs.
- Keep injected content-script UI isolated from page CSS.
- Avoid adding a build pipeline or package manager dependency unless the project explicitly decides to change release strategy.

## Pull Requests

Pull requests should explain the behaviour change, verification performed, and any limitations. For user-visible changes, update `README.md`, `HARNESS.md`, or `AGENTS.md` when relevant.
