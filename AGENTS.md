# AGENTS.md

Guidance for coding agents working in this repository.

## Project Summary

No Way! is a Manifest V3 Chrome extension for preventing accidental web-app mutations during OSINT investigations. It uses a dynamic, per-origin training and rules system:

- Analysts grant access to one origin at a time.
- Training mode prompts on risky actions and lets the analyst choose Block or Always allow.
- Protection mode blocks actions that match active stored or starter rules.
- Protection can optionally prompt for Allow once on blocked actions.
- Rules are stored locally in Chrome extension storage and can be exported/imported as JSON.

There is no build step. Load the repository root as an unpacked extension.

## Development Commands

Load manually through `chrome://extensions/` with Developer mode enabled, or use the harness.

Preinstall Chrome for Testing when you want to set it up explicitly:

```sh
node tools/install-chrome-for-testing.mjs
```

The harness also installs Chrome for Testing automatically under `.harness/chrome-for-testing` when no compatible binary is found.

Create or refresh a persistent logged-in profile:

```sh
node tools/harness.mjs --seed-profile .harness/accounts --url https://www.linkedin.com/
```

Run the extension against a temporary clone of that profile:

```sh
node tools/harness.mjs --url https://www.linkedin.com/feed/
```

Run with a clean temporary profile:

```sh
node tools/harness.mjs --url https://example.com/ --no-profile-source
```

After extension edits, reload the unpacked extension and refresh any tabs that need updated content scripts.

## Verification

No linter or full test runner is configured. At minimum, run syntax checks for edited JavaScript:

```sh
node --check background/service_worker.js
node --check content/guard-main.js
node --check content/guard-controller.js
node --check popup/popup.js
node --check options/rules.js
```

Use `node tools/harness.mjs` for browser-level verification. The harness auto-installs Chrome for Testing when needed, and can also detect binaries installed by `node tools/install-chrome-for-testing.mjs` or Puppeteer Browser installs under `chrome/`.

## Extension Architecture

`manifest.json` declares an MV3 extension with `storage`, `scripting`, `tabs`, and optional `http://*/*` / `https://*/*` host permissions. The extension should request site access per origin rather than asking for broad access upfront.

`background/service_worker.js` owns rule storage, host permission state, dynamic content script registration, import/export, rule updates, and the bundled LinkedIn starter rules.

`content/guard-main.js` runs in the MAIN world at `document_start`. It listens in capture phase and synchronously stops risky or blocked interactions before page handlers run.

`content/guard-controller.js` runs in the ISOLATED world. It handles extension messaging, training prompts, toasts, allow-once updates, and the in-page No Way! badge.

`popup/` identifies the active tab origin, requests optional host access, toggles Training and Protection, shows the rule count, links to the rule manager, and supports import/export.

`options/` is the rule manager. It supports viewing per-origin rules, enable/disable, individual delete, select-all per origin, bulk delete, and import/export.

## Rule Store

Rules are stored in `chrome.storage.local` under `osintGuardRulesV1`.

Per-origin state contains:

- `trainingEnabled`
- `protectionEnabled`
- `protectionAllowOnce`
- `rules[]`
- `deletedStarterRuleIds[]`
- `updatedAt`

Each rule contains:

- `id`
- `source` (`learned` or `starter`)
- `kind` (`block` or `allow`)
- `enabled`
- `actionKey`
- `label`
- `match`
- `confidence`
- `createdAt`
- `updatedAt`
- `hitCount`

LinkedIn starter rules are generated for `https://www.linkedin.com` unless they have been deleted. Starter deletions are persisted in `deletedStarterRuleIds` so deleted starter rules do not come back on reload.

## Training And Protection Semantics

Training mode is for analyst choice. Risky actions and actions matching existing rules should prompt first, even if a starter rule already exists. For example, clicking Like on LinkedIn in Training mode should show the Block / Always allow prompt.

Protection mode is enforcement. Active stored and starter block rules block immediately, unless `protectionAllowOnce` is enabled and the analyst chooses Allow once from the protection prompt. Explicit allow rules override matching block rules. Unknown risky actions are allowed silently when Training mode is off.

Prompt choices:

- `Block`: stops the current event and saves or enables a learned block rule.
- `Always allow`: stops the current event and saves or enables a learned allow rule.
- `Allow once`: available from the protection prompt when `protectionAllowOnce` is enabled. It stops the current event, allows the same element fingerprint for 10 seconds, and expects the analyst to click again. Do not replay synthetic clicks.

Rule changes must take effect in already-open same-origin tabs without requiring a reload. Preserve the service-worker refresh path that injects the guard scripts when needed and sends `OSINT_STATE_CHANGED` after training/protection toggles, rule creation, import, update, and delete.

## Regex Matching And Confidence

Risk detection is local regex/action-term matching only. It looks for mutating actions such as reaction/favourite, follow, connect, comment, share, boost/promote, message, post, delete, purchase, endorse/recommend, and save. It avoids normal browsing/search/filter/menu/read-only controls.

Do not add on-device or remote model-based detection unless explicitly requested.

Learned rules should capture the risky action, not the specific person/object in the label. For example, `Follow Jane Doe` should train and match as the origin-wide `Follow` action.

Only the clicked element and its ancestors should count as the action target. Do not scan descendants of clicked containers; otherwise backdrop/modal clicks can be misclassified as Like/Follow actions hidden inside the container.

Confidence is internal metadata and should not be surfaced in the analyst UI. It is not a risk probability. It describes how stable the learned match evidence is:

- `0.82`: `data-test*` or `aria-label` selector evidence.
- `0.72`: stable ID evidence.
- `0.62`: accessible label evidence.
- `0.45`: weak fallback metadata.
- LinkedIn starter rules are hand-authored at `0.9` or `0.95`.

Rule blocking does not currently depend on confidence; blocking depends on rule match and enabled state.

## Implementation Notes

- Prefer stable selectors and accessible metadata over brittle classes or positional selectors.
- Keep site functionality intact: do not blanket-block all clicks.
- Keep content scripts idempotent; they may be injected into already-open pages.
- Injected prompt/toast/badge UI uses inline `all:initial` styling to avoid page CSS bleed.
- Storage access should remain restricted to trusted extension contexts where Chrome supports `chrome.storage.local.setAccessLevel`.
- Do not add a build pipeline unless explicitly requested.
