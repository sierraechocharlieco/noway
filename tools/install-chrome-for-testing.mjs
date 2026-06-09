#!/usr/bin/env node
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadataUrl = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const channel = readArg('--channel') || 'Stable';
const wantedPlatform = readArg('--platform') || detectPlatform();

if (!wantedPlatform) {
  console.error(`Unsupported platform: ${platform()} ${arch()}`);
  process.exit(1);
}

console.log(`Fetching Chrome for Testing metadata (${channel}, ${wantedPlatform})...`);
const metadata = await fetchJson(metadataUrl);
const channelInfo = metadata.channels?.[channel];
if (!channelInfo) {
  console.error(`Unknown channel: ${channel}`);
  process.exit(1);
}

const download = channelInfo.downloads.chrome.find((item) => item.platform === wantedPlatform);
if (!download) {
  console.error(`No Chrome download found for ${channel} on ${wantedPlatform}`);
  process.exit(1);
}

const installDir = resolve(repoRoot, '.harness/chrome-for-testing', `${channelInfo.version}-${wantedPlatform}`);
const zipPath = resolve(repoRoot, '.harness/downloads', `chrome-${channelInfo.version}-${wantedPlatform}.zip`);
const executable = resolveExecutable(installDir, wantedPlatform);

if (existsSync(executable) && !process.argv.includes('--force')) {
  console.log(`Chrome for Testing already installed: ${executable}`);
  process.exit(0);
}

await mkdir(dirname(zipPath), { recursive: true });
await mkdir(dirname(installDir), { recursive: true });
await rm(installDir, { recursive: true, force: true });

console.log(`Downloading ${download.url}`);
await downloadFile(download.url, zipPath);

console.log(`Extracting to ${installDir}`);
await mkdir(installDir, { recursive: true });
await run('unzip', ['-q', zipPath, '-d', installDir]);

if (!existsSync(executable)) {
  console.error(`Installed archive did not contain expected executable: ${executable}`);
  process.exit(1);
}

console.log(`Chrome for Testing installed: ${executable}`);
console.log('The harness will pick this binary automatically.');

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${name} requires a value`);
    process.exit(1);
  }
  return value;
}

function detectPlatform() {
  if (platform() === 'darwin' && arch() === 'arm64') return 'mac-arm64';
  if (platform() === 'darwin' && arch() === 'x64') return 'mac-x64';
  if (platform() === 'linux' && arch() === 'x64') return 'linux64';
  return null;
}

function resolveExecutable(root, targetPlatform) {
  if (targetPlatform === 'mac-arm64') {
    return resolve(root, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  }
  if (targetPlatform === 'mac-x64') {
    return resolve(root, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  }
  return resolve(root, 'chrome-linux64/chrome');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  await pipeline(response.body, createWriteStream(destination));
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', rejectRun);
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${code}`));
    });
  });
}
