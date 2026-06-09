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
