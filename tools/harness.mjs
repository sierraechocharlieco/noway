#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultUrl = 'https://www.linkedin.com/feed/';
const defaultProfileSource = '.harness/accounts';

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  printHelp();
  process.exit(1);
}

if (args.help) {
  printHelp();
  process.exit(0);
}

let chromeResolution = resolveChromeForTesting(args.chrome);
const url = args.url || defaultUrl;
const devtools = args.devtools !== false;
const keepProfile = Boolean(args.keepProfile);
const seedProfile = args.seedProfile ? resolve(repoRoot, args.seedProfile) : null;
const sourceProfile = args.profileSource === false
  ? null
  : resolve(repoRoot, args.profileSource || defaultProfileSource);

if (!chromeResolution.path && !chromeResolution.error && !args.chrome) {
  try {
    await installLocalChromeForTesting();
  } catch (error) {
    console.error(`Chrome for Testing installation failed: ${error.message}`);
    process.exit(1);
  }
  chromeResolution = resolveChromeForTesting(args.chrome);
}

if (!chromeResolution.path) {
  console.error(chromeResolution.error || 'Could not find Chrome for Testing.');
  console.error('Install Chrome for Testing with: node tools/install-chrome-for-testing.mjs');
  console.error('Or pass --chrome /path/to/chrome-for-testing.');
  process.exit(1);
}

const chromePath = chromeResolution.path;

const tempParent = seedProfile ? null : await mkdtemp(resolve(tmpdir(), 'osint-guard-'));
const userDataDir = seedProfile || resolve(tempParent, 'profile');

if (seedProfile) {
  await mkdir(seedProfile, { recursive: true });
  console.log(`Using persistent seed profile: ${seedProfile}`);
  console.log('Sign in here when you need to refresh stored accounts. Normal harness runs clone this profile into a temp profile.');
} else {
  await mkdir(userDataDir, { recursive: true });
  if (sourceProfile && existsSync(sourceProfile)) {
    console.log(`Cloning logged-in profile: ${sourceProfile}`);
    await copyProfile(sourceProfile, userDataDir);
  } else if (sourceProfile) {
    console.log(`No saved profile found at ${sourceProfile}; launching a clean temporary profile.`);
    console.log('Create one with: node tools/harness.mjs --seed-profile .harness/accounts --url https://www.linkedin.com/');
  }
  console.log(`Temporary profile: ${userDataDir}`);
}

const chromeArgs = [
  `--user-data-dir=${userDataDir}`,
  '--profile-directory=Default',
  `--disable-extensions-except=${repoRoot}`,
  `--load-extension=${repoRoot}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  '--new-window',
];

if (devtools) chromeArgs.push('--auto-open-devtools-for-tabs');
chromeArgs.push(url);

console.log(`Loading extension from: ${repoRoot}`);
console.log(`Chrome for Testing: ${chromePath}`);
console.log(`Opening: ${url}`);
console.log(`Module scout snippet: ${resolve(repoRoot, 'tools/module-scout.js')}`);

let chromeExited = false;
let devtoolsBrowserUrl = null;
let shuttingDown = false;

const chrome = spawn(chromePath, chromeArgs, {
  stdio: ['ignore', 'pipe', 'pipe'],
});

chrome.stdout.on('data', (chunk) => process.stdout.write(chunk));
chrome.stderr.on('data', (chunk) => {
  const text = String(chunk);
  process.stderr.write(text);
  const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
  if (match) {
    devtoolsBrowserUrl = match[1];
    console.log(`Chrome DevTools Protocol: ${devtoolsBrowserUrl}`);
  }
});

chrome.on('error', async (error) => {
  if (tempParent) await rm(tempParent, { recursive: true, force: true });
  console.error(`Failed to launch Chrome: ${error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => shutdown('SIGINT'));

process.on('SIGTERM', () => shutdown('SIGTERM'));

chrome.on('exit', async (code, signal) => {
  chromeExited = true;
  if (tempParent && !keepProfile) {
    await rm(tempParent, { recursive: true, force: true });
  } else if (tempParent) {
    console.log(`Kept temporary profile: ${userDataDir}`);
  }

  if (signal) process.exit(128);
  process.exit(code ?? 0);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}; closing Chrome gracefully so profile data can flush...`);
  const closed = await closeChromeGracefully();
  if (!closed && !chromeExited) {
    console.warn('Could not close Chrome through DevTools; sending SIGTERM.');
    chrome.kill('SIGTERM');
  }

  setTimeout(() => {
    if (!chromeExited) {
      console.warn('Chrome did not exit after graceful shutdown; forcing close.');
      chrome.kill('SIGKILL');
    }
  }, 5000).unref();
}

async function closeChromeGracefully() {
  try {
    const browserUrl = devtoolsBrowserUrl || await readDevToolsBrowserUrl();
    if (!browserUrl) return false;

    await sendBrowserClose(browserUrl);
    return true;
  } catch (error) {
    console.warn(`Graceful Chrome close failed: ${error.message}`);
    return false;
  }
}

async function readDevToolsBrowserUrl() {
  const activePortPath = resolve(userDataDir, 'DevToolsActivePort');
  if (!existsSync(activePortPath)) return null;

  const [port, browserPath] = (await readFile(activePortPath, 'utf8')).trim().split(/\r?\n/);
  if (!port || !browserPath) return null;

  return `ws://127.0.0.1:${port}${browserPath}`;
}

function sendBrowserClose(browserUrl) {
  return new Promise((resolveClose, rejectClose) => {
    const ws = new WebSocket(browserUrl);
    const timeout = setTimeout(() => {
      ws.close();
      rejectClose(new Error('timed out waiting for Browser.close'));
    }, 3000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) {
        clearTimeout(timeout);
        ws.close();
        resolveClose();
      }
    });

    ws.addEventListener('close', () => {
      clearTimeout(timeout);
      resolveClose();
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      rejectClose(new Error('DevTools WebSocket error'));
    });
  });
}

function parseArgs(argv) {
  const parsed = {
    devtools: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
      return next;
    };

    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--url') parsed.url = readValue();
    else if (arg === '--chrome') parsed.chrome = readValue();
    else if (arg === '--profile-source') parsed.profileSource = readValue();
    else if (arg === '--no-profile-source') parsed.profileSource = false;
    else if (arg === '--seed-profile' || arg === '--persistent-profile') parsed.seedProfile = readValue();
    else if (arg === '--keep-profile') parsed.keepProfile = true;
    else if (arg === '--devtools') parsed.devtools = true;
    else if (arg === '--no-devtools') parsed.devtools = false;
    else if (!parsed.url) parsed.url = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function copyProfile(source, target) {
  await cp(source, target, {
    recursive: true,
    filter: (path) => {
      const name = path.split(/[\\/]/).pop();
      return ![
        'SingletonCookie',
        'SingletonLock',
        'SingletonSocket',
      ].includes(name);
    },
  });
}

function installLocalChromeForTesting() {
  const installer = resolve(repoRoot, 'tools/install-chrome-for-testing.mjs');
  console.log('Chrome for Testing is not installed; installing it now...');

  return new Promise((resolveInstall, rejectInstall) => {
    const child = spawn(process.execPath, [installer], { stdio: 'inherit' });
    child.on('error', rejectInstall);
    child.on('exit', (code) => {
      if (code === 0) resolveInstall();
      else rejectInstall(new Error(`Chrome for Testing installer exited with ${code}`));
    });
  });
}

function resolveChromeForTesting(explicitPath) {
  const configuredCandidates = [
    ['--chrome', explicitPath],
    ['OSINT_GUARD_CHROME', process.env.OSINT_GUARD_CHROME],
  ].filter(([, candidate]) => Boolean(candidate));

  for (const [source, candidate] of configuredCandidates) {
    const resolution = resolveConfiguredChromeForTesting(source, candidate);
    if (!resolution.path) return resolution;
    return resolution;
  }

  const targetPlatform = detectChromeForTestingPlatform();
  if (!targetPlatform) {
    return { error: `Unsupported Chrome for Testing platform: ${platform()} ${arch()}` };
  }

  const candidates = [
    findLocalChromeForTesting(targetPlatform),
    findPuppeteerChromeForTesting(targetPlatform),
    ...systemChromeForTestingCandidates(targetPlatform),
  ].filter(Boolean);

  const path = candidates.find((candidate) => existsSync(candidate));
  if (path) return { path };

  if (process.env.CHROME_PATH) {
    return resolveConfiguredChromeForTesting('CHROME_PATH', process.env.CHROME_PATH);
  }

  return {};
}

function resolveConfiguredChromeForTesting(source, candidate) {
  if (!existsSync(candidate)) {
    return { error: `${source} points to a missing Chrome for Testing binary: ${candidate}` };
  }
  if (!isChromeForTestingPath(candidate)) {
    return {
      error: `${source} must point to Chrome for Testing, not regular Chrome/Chromium: ${candidate}`,
    };
  }
  return { path: candidate };
}

function findLocalChromeForTesting(targetPlatform) {
  const installRoot = resolve(repoRoot, '.harness/chrome-for-testing');
  if (!existsSync(installRoot)) return null;

  return findChromeForTestingInVersionedDirs(installRoot, chromeForTestingExecutableSuffix(targetPlatform));
}

function findPuppeteerChromeForTesting(targetPlatform) {
  const installRoot = resolve(repoRoot, 'chrome');
  if (!existsSync(installRoot)) return null;

  return findChromeForTestingInVersionedDirs(installRoot, chromeForTestingExecutableSuffix(targetPlatform));
}

function findChromeForTestingInVersionedDirs(installRoot, executableSuffix) {
  const dirs = readdirSync(installRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const dir of dirs) {
    const executable = resolve(installRoot, dir, executableSuffix);
    if (existsSync(executable)) return executable;
  }

  return null;
}

function detectChromeForTestingPlatform() {
  if (platform() === 'darwin' && arch() === 'arm64') return 'mac-arm64';
  if (platform() === 'darwin' && arch() === 'x64') return 'mac-x64';
  if (platform() === 'linux' && arch() === 'x64') return 'linux64';
  return null;
}

function chromeForTestingExecutableSuffix(targetPlatform) {
  if (targetPlatform === 'mac-arm64') {
    return 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  }
  if (targetPlatform === 'mac-x64') {
    return 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  }
  return 'chrome-linux64/chrome';
}

function systemChromeForTestingCandidates(targetPlatform) {
  if (targetPlatform.startsWith('mac-')) {
    return [
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ];
  }

  return [
    '/opt/google/chrome-for-testing/chrome-linux64/chrome',
    '/usr/local/bin/chrome-for-testing',
    '/usr/bin/chrome-for-testing',
  ];
}

function isChromeForTestingPath(candidate) {
  const normalized = candidate.replaceAll('\\', '/');
  return normalized.includes('/.harness/chrome-for-testing/')
    || normalized.includes('/chrome-for-testing/')
    || normalized.includes('/chrome-mac-arm64/Google Chrome for Testing.app/')
    || normalized.includes('/chrome-mac-x64/Google Chrome for Testing.app/')
    || normalized.includes('/Google Chrome for Testing.app/')
    || normalized.endsWith('/chrome-linux64/chrome')
    || normalized.endsWith('/chrome-for-testing');
}

function printHelp() {
  console.log(`
No Way! browser harness

Usage:
  node tools/harness.mjs [--url URL] [options]

Common flows:
  node tools/harness.mjs --seed-profile .harness/accounts --url https://www.linkedin.com/
    Opens a persistent .harness/accounts Chrome for Testing profile. Sign in to target sites here.

  node tools/harness.mjs --url https://www.linkedin.com/feed/
    Clones .harness/accounts into a temporary profile, loads the extension, and opens DevTools.

  node tools/harness.mjs --url https://example.com/ --no-profile-source
    Opens a clean temporary profile.

Debug / monitoring:
  node tools/action-monitor.mjs
    Streams every intercepted click + internal extension decision to the terminal.
    Works against a running harness (reads DevTools port from profile).

Options:
  --url URL                    Site to open. Positional URL also works.
  --profile-source DIR         Logged-in profile to clone into a temp profile. Default: .harness/accounts
  --no-profile-source          Start from a clean temp profile.
  --seed-profile DIR           Use a persistent profile directly, for login/setup.
  --persistent-profile DIR     Alias for --seed-profile.
  --keep-profile               Do not delete the temp profile when Chrome exits.
  --devtools / --no-devtools   Auto-open DevTools for tabs. Default: --devtools
  --chrome PATH                Chrome for Testing executable path. CHROME_PATH also works.

Browser installation:
  node tools/install-chrome-for-testing.mjs
    Installs a local Chrome for Testing binary under .harness/chrome-for-testing.

  If no Chrome for Testing binary is found, the harness runs that installer automatically.
`);
}
