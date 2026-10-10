# No Way!

No Way! is a Manifest V3 Chrome extension from [Sierra Echo Charlie](https://sierraechocharlie.com) that helps analysts avoid accidental web-app mutations during OSINT investigations.

It is designed for cautious browsing on sites where a stray click can like, follow, connect, comment, share, message, save, delete, purchase, or otherwise change state. Analysts grant access to one origin at a time, train risky actions locally, and then use protection mode to block matching actions.

## Demo

[<img src="https://img.youtube.com/vi/LKWsLTG0D7E/maxresdefault.jpg" alt="Watch the No Way! demo" width="600">](https://www.youtube.com/watch?v=LKWsLTG0D7E)

## Project Status

No Way! is being open sourced as part of an experiment series about what vibe coding can and cannot produce. It is a developer-mode Chrome extension, not a production release, and it has not been designed, reviewed, or packaged as a production safety product.

Treat it as a local guardrail for careful manual workflows, not as a security boundary or a guarantee that accidental mutations cannot happen. Detection is heuristic, web apps change often, and unknown or changed actions may pass through until they are trained and verified.

This first open-source release supports developer-mode extension loading only. It is not packaged for the Chrome Web Store.

## What It Does

- Requests host access per origin instead of asking for broad site access up front.
- Prompts in Manual training when a risky action is detected.
- Offers optional Auto training with Chrome’s local Gemini Nano model.
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

Manual training asks for analyst choice and stores block or allow rules. Protection mode enforces active rules. Unknown risky actions are allowed silently when Training mode is off, so train each platform before relying on Protection mode.

## Auto training

Auto is an experimental, per-site training option. Turn on **Auto** in the popup to start Training and open the model panel. The tooltip explains local processing. In the panel, choose **Download local model** or **Start local model**. Chrome manages Gemini Nano; no API key is required.

Keep the panel open in the same browser window while using Auto. Clear mutating actions are learned as block rules. For unfamiliar controls, Nano describes what the control does from a short summary of it; No Way! decides what happens. Actions that change something are blocked and learned. Actions that could reveal you, such as viewing a story or joining a live stream, go to manual review. A read-only answer counts only when the label also reads as read-only, so many ordinary links still need review. Safe controls can be checked ahead of a click; if an action was paused for a check, click again within 10 seconds to continue. No Way! never replays your click.

Uncertain actions, timeouts, unsupported devices, and closing the model panel use manual review for undecided controls. The badge and popup show **Auto paused** when the model is unavailable. Existing explicit Allow rules take precedence. Nano never creates permanent Allow rules or overrides an existing block.

Auto supports English labels in this release. [Chrome’s device requirements](https://developer.chrome.com/docs/ai/get-started) determine model availability; installing Chrome alone does not ensure support. Classification can be wrong, and unsupported gesture paths or page behavior can escape the guard. Real-model accuracy targets in the spec have not been established for this release.

Learned blocks work in Protection without the model or panel. Disable Training to use those rules. Deleting or disabling a rule prevents Auto from recreating it; **Retrain removed actions** in the rule manager clears those suppressions. JSON exports remain version 1 and contain reusable rules, without model prompts, caches, or Auto preferences. Importing sets affected sites to Manual training; it never enables Auto.

## Privacy And Data

- Rules and settings are stored locally through `chrome.storage.local`.
- The extension does not call a remote detection service.
- Manual detection uses local regex and action-term matching. Optional Auto training adds local Prompt API classification; action checks are not sent to a cloud service.
- Chrome may download its model during setup. No Way! does not collect full pages, messages, drafts, input values, or credentials for classification. Before classification, numbers, @handles, web addresses, and email addresses in a control’s label are replaced with placeholders, and links are described only as pointing to the same site or another site. A label can still include names. Only minimal match evidence is persisted with a learned rule.
- SEC fonts and artwork are bundled locally. In-page notices use Shadow DOM; the public asset list contains only the betta and UI fonts, with no additional site permissions.
- Brand fonts are bundled locally; the interface does not fetch fonts from a CDN.
- Import and export are user-initiated JSON file operations.
- The development harness can use local Chrome profiles under `.harness/`; that directory is ignored by git except for `.harness/.gitkeep`.

The harness installs Chrome for Testing on first use when no compatible binary is found. It downloads Chrome for Testing from Google-hosted metadata and archives into `.harness/chrome-for-testing`; this is only for local development and verification.

## Development

There is no build step and no package manager install is required.

The development tools require Node.js 22 or later and run on macOS, Linux, and Windows 10+. Extracting the Chrome for Testing archive uses `unzip` on macOS and Linux (preinstalled on macOS) and `tar` on Windows (preinstalled on Windows 10+).

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

See [the Auto training specification](SPEC_AUTO_TRAINING.md) for the design, model contract, and experimental release gates.

## Limitations

- This is an experimental, vibe-coded release, not a production safety product.
- Developer-mode loading is the only supported installation path for this release.
- There is no Chrome Web Store package, listing, signing, or store privacy declaration yet.
- Detection is heuristic, local, and site-dependent.
- Unknown risky actions may be allowed silently when Training mode is off. Auto does not change Protection into a continuous model check.
- Sites can change markup, labels, event handling, or flows in ways that reduce rule coverage.
- Starter rules are currently focused on LinkedIn.
- No Way! cannot guarantee that every mutating action will be blocked; train and smoke test each platform before relying on Protection mode.

## Contributing

Bug reports, feature requests, and support questions should use GitHub Issues once the repository is public. Security reports should not include sensitive details in public issues; see `SECURITY.md`.

See `CONTRIBUTING.md` for development expectations.

## Licence

MIT. See `LICENSE`.
