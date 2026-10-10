# No Way! Harness

Use the harness to run the unpacked extension in Chrome for Testing with a disposable browser profile and DevTools ready for module work.

## 0. Test browser

Chrome for Testing is required because it is the Chrome flavour built for repeatable browser automation, and regular Stable Chrome may ignore command-line unpacked-extension loading on some systems. If Chrome for Testing is not already available, the harness installs it automatically under `.harness/chrome-for-testing`.

You can also preinstall or refresh it manually:

```sh
node tools/install-chrome-for-testing.mjs
```

The harness will pick the macOS, Linux, or Windows binary automatically. It also detects Chrome for Testing installed by `npx @puppeteer/browsers install chrome@stable` under `chrome/`. It does not fall back to regular Chrome or Chromium.

The tools require Node.js 22 or later. Extracting the downloaded archive uses `unzip` on macOS and Linux and `tar` on Windows 10+; both are preinstalled on macOS and Windows, while some Linux distributions need `unzip` installed from their package manager.

## 1. Create a logged-in seed profile

```sh
node tools/harness.mjs --seed-profile .harness/accounts --url https://www.linkedin.com/
```

Sign in to the accounts you need in that browser window. This profile is kept under `.harness/accounts`, which is ignored by git.
If you close the browser normally, or stop the harness with Ctrl+C, the harness asks Chrome to shut down gracefully so cookies and storage can flush. Do not use `kill -9` for the login/profile setup flow.

After logging in, close Chrome normally once before using temporary test runs. That gives the seed profile a clean on-disk baseline.

## 2. Launch a temporary copy

```sh
node tools/harness.mjs --url https://www.linkedin.com/feed/
```

By default, the harness:

- clones `.harness/accounts` into an OS temp directory
- loads this repo as an unpacked extension
- opens Chrome DevTools for tabs
- exposes Chrome DevTools Protocol on an ephemeral port
- deletes the temp profile when Chrome exits

This mode is for investigation runs. It starts from the seed profile, but account changes made inside the temporary copy are not written back to `.harness/accounts`.
If a target site logs you out in a temporary run, refresh the seed profile by repeating step 1.

Useful variants:

```sh
node tools/harness.mjs --url https://example.com/ --no-profile-source
node tools/harness.mjs --url https://example.com/ --profile-source .harness/another-account
node tools/harness.mjs --url https://example.com/ --keep-profile
node tools/harness.mjs --url https://example.com/ --no-devtools
```

## 3. Scout a site for a new module

Launch the harness on the target site, open the DevTools Console, and paste the contents of:

```sh
node tools/print-scout-snippet.mjs
```

Then run:

```js
NoWayModuleScout.scan()
NoWayModuleScout.blockedSelectorDraft(['like', 'follow', 'comment', 'share', 'send'])
```

The scout reports visible interactive controls, ARIA labels, roles, text, geometry, and selector candidates. Use those results to refine starter rules in `background/service_worker.js` or to compare against dynamically learned rules from training mode.

## 4. Monitor live actions

With the harness browser running, attach a live action monitor:

```sh
node tools/action-monitor.mjs
```

The monitor prints click, submit, and Enter-key actions with selector candidates and whether No Way! showed a block toast. Use this while manually exploring a site to find dangerous actions that the module misses.

## Auto training verification

For real Prompt API testing, use branded Google Chrome in a dedicated persistent profile:

```sh
node tools/harness.mjs --prompt-api --url https://www.linkedin.com/feed/ --no-devtools
```

This mode uses `.harness/prompt-api-google` by default; override it with `--persistent-profile DIR`. It loads No Way! through Chrome's developer API, since branded Chrome no longer supports the harness's command-line extension loading. Developer extension debugging is enabled only in this separate test profile. Use `--chrome PATH` if Chrome is installed elsewhere. Close that test browser before restarting the harness.

Branded Google Chrome 155.0.8059.39 on this Linux machine completed No Way!'s real model setup and structured-output compatibility check. Warm samples classified Search as safe and Send message as risky in roughly 0.45–0.5 seconds. A Follow sample returned uncertain. These few smoke checks establish that the runtime works, not that the release accuracy targets have been met.

Initial model setup downloads several gigabytes; open the No Way! model panel and use its download/setup button. Keep the panel open while using Auto. Use a filesystem with at least 22 GB free, and a machine meeting [Chrome's hardware requirements](https://developer.chrome.com/docs/ai/get-started#hardware). A temporary `/tmp` profile on a small RAM disk can fail those requirements.

The Linux Chrome for Testing 155.0.8059.39 binary used here lacks `liboptimization_guide_internal.so` and returns Chromium's stub inference output, even after downloading Nano weights. That build works for integration tests, but cannot establish real model accuracy or latency. Its default component updates are also disabled; see [Chrome for Testing configuration](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/chrome_for_testing/chrome_for_testing_configuration.md). Do not treat `LanguageModel.availability() === 'available'` alone as proof of real inference.

Run `node tests/auto.test.mjs` for deterministic model-contract and worker tests, in addition to syntax checks for edited JavaScript.

`tests/browser-auto.mjs` starts the existing headed harness on local mutation-counter fixtures. Set `NOWAY_TEST_CHROME` to a Chrome for Testing binary and make Playwright available on `NODE_PATH` (it can be installed outside the extension repository). No production dependency or build step is needed. For example:

```sh
NODE_PATH=/path/to/node_modules NOWAY_TEST_CHROME=/path/to/chrome node tests/browser-auto.mjs
```

The browser checks copy the extension into a temporary directory, grant only localhost through that copy’s test manifest, and substitute a fake Prompt API in the test model document. Production host permissions and model code are unchanged. The checks cover automatic blocks, exact unfamiliar-action rules, safe retries while the mouse gesture is held, timeouts, manual overrides, stale evidence, Protection, deletions, host closure, and compact light/dark UI. Screenshots are written under `/tmp/noway-auto-*`.

The test prints native Prompt API availability before substituting the fake. A passing fake-model run proves policy integration, not Nano accuracy or a successful model download. On a supported device, verify setup/download through the real side-panel button, cold startup, and warm offline use. The held-out classification targets in SPEC_AUTO_TRAINING.md remain release evaluation work; Auto is experimental until that evaluation passes.

Browser checks also exercise repeated guard injection, immediate cache invalidation on SPA navigation, SEC font loading, hostile page CSS, live Manual/Protection changes, tooltip dismissal, and the rule editor/export/delete dialogs. Screenshots cover both themes, 320px surfaces, and 200% text in extension pages. Unit tests cover cancelled/stalled model sessions, permission removal, rejected JSON edits, and host closure during rule validation. These tests use fixtures and do not establish coverage for every target site's event handlers.

The browser suite also opens the actual toolbar popup through Chrome's action API and measures its native content width and action placement. Tab previews alone cannot detect Chrome's popup auto-sizing failures.
