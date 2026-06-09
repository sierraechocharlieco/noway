# No Way!

No Way! is a Manifest V3 Chrome extension from [Sierra Echo Charlie](https://sierraechocharlie.com) that helps analysts avoid accidental web-app mutations during OSINT investigations.

It is designed for cautious browsing on sites where a stray click can like, follow, connect, comment, share, message, save, delete, purchase, or otherwise change state. Analysts grant access to one origin at a time, train risky actions locally, and then use protection mode to block matching actions.

## Demo

[![Watch the No Way! demo](https://img.youtube.com/vi/LKWsLTG0D7E/hqdefault.jpg)](https://youtu.be/LKWsLTG0D7E)

## Project Status

No Way! is being open sourced as part of an experiment series about what vibe coding can and cannot produce. It is a developer-mode Chrome extension, not a production release, and it has not been designed, reviewed, or packaged as a production safety product.

Treat it as a local guardrail for careful manual workflows, not as a security boundary or a guarantee that accidental mutations cannot happen. Detection is heuristic, web apps change often, and unknown or changed actions may pass through until they are trained and verified.

This first open-source release supports developer-mode extension loading only. It is not packaged for the Chrome Web Store.

## What It Does

- Requests host access per origin instead of asking for broad site access up front.
- Prompts in Training mode when a risky action is detected.
- Blocks active learned or starter rules in Protection mode.
- Stores rules locally in Chrome extension storage.
- Exports and imports rules as JSON.
- Includes LinkedIn starter rules for common risky actions.
- Provides a local browser harness for manual extension testing.

## Install In Developer Mode

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository root.

After editing extension files, reload the unpacked extension from `chrome://extensions/`. Tabs with injected content scripts may also need to be refreshed.

## Basic Workflow

1. Open the site you want to investigate.
2. Open the No Way! popup and grant site access for the current origin.
3. Enable **Training mode**.
4. When prompted on a risky action, choose:
   - **Block** to save or enable a rule.
   - **Always allow** to record an explicit allow rule and stop prompting for that action.
5. Disable Training mode and leave **Protection** enabled to block matching actions.
6. Optionally enable **Allow once in protection** when you want blocked actions to prompt with **Allow once** / **Block** instead of being stopped silently.
7. Use **Manage Rules** to inspect, enable, disable, delete, import, or export rules.

Training mode asks for analyst choice and stores block or allow rules. Protection mode enforces active rules. Unknown risky actions are allowed silently when Training mode is off, so train each platform before relying on Protection mode.

## Privacy And Data

- Rules and settings are stored locally through `chrome.storage.local`.
- The extension does not call a remote detection service.
- Risk detection is local regex and action-term matching.
- Import and export are user-initiated JSON file operations.
- The development harness can use local Chrome profiles under `.harness/`; that directory is ignored by git except for `.harness/.gitkeep`.

The harness installs Chrome for Testing on first use when no compatible binary is found. It downloads Chrome for Testing from Google-hosted metadata and archives into `.harness/chrome-for-testing`; this is only for local development and verification.

## Development

There is no build step and no package manager install is required.

Run syntax checks after editing JavaScript:

```sh
node --check background/service_worker.js
node --check content/guard-main.js
node --check content/guard-controller.js
node --check popup/popup.js
node --check options/rules.js
```

For browser-level verification, use the harness:

```sh
node tools/harness.mjs --url https://example.com/ --no-profile-source
```

See `HARNESS.md` for logged-in profile workflows and module scouting tools.

## Limitations

- This is an experimental, vibe-coded release, not a production safety product.
- Developer-mode loading is the only supported installation path for this release.
- There is no Chrome Web Store package, listing, signing, or store privacy declaration yet.
- Detection is heuristic, local, and site-dependent.
- Unknown risky actions may be allowed silently when Training mode is off.
- Sites can change markup, labels, event handling, or flows in ways that reduce rule coverage.
- Starter rules are currently focused on LinkedIn.
- No Way! cannot guarantee that every mutating action will be blocked; train and smoke test each platform before relying on Protection mode.

## Contributing

Bug reports, feature requests, and support questions should use GitHub Issues once the repository is public. Security reports should not include sensitive details in public issues; see `SECURITY.md`.

See `CONTRIBUTING.md` for development expectations.

## Licence

MIT. See `LICENSE`.
