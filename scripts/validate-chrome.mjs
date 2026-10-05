#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { validateArchiveProductionEndpoints } from './validate-endpoints.mjs';

const [archivePath, expectedVersion, expectedSha256] = process.argv.slice(2);

if (!archivePath || !expectedVersion) {
  throw new Error('Usage: validate_gram_chrome_package.mjs <archive.zip> <expected-version> [expected-sha256]');
}

assert.ok(fs.statSync(archivePath).isFile(), `${archivePath} is not a file`);
if (process.argv.length >= 5) {
  assert.match(expectedSha256, /^[a-f0-9]{64}$/, 'Expected SHA-256 must be a full lowercase digest');
  const actualSha256 = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
  assert.equal(actualSha256, expectedSha256, 'Downloaded package SHA-256 differs from the validated build');
}

const unzip = (args) => execFileSync('unzip', args, {
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
});
const entries = unzip(['-Z1', archivePath])
  .trim()
  .split('\n')
  .map((entry) => entry.replace(/^\.\//, ''));
const entrySet = new Set(entries);

assert.ok(entrySet.has('manifest.json'), 'manifest.json must be at the package root');
assert.ok(!entries.some((entry) => entry.startsWith('_metadata/')), 'generated _metadata must not be packaged');

const manifest = JSON.parse(unzip(['-p', archivePath, 'manifest.json']));
assert.deepEqual(Object.keys(manifest).sort(), [
  'action',
  'background',
  'content_scripts',
  'content_security_policy',
  'description',
  'icons',
  'manifest_version',
  'name',
  'permissions',
  'version',
  'web_accessible_resources',
], 'Manifest keys differ from the approved Gram package');
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'Gram Wallet');
assert.equal(manifest.description, 'Set up your own Gram Wallet on The Open Network');
assert.equal(manifest.version, expectedVersion);
assert.deepEqual(manifest.action, { default_title: 'Gram Wallet' });
assert.deepEqual(manifest.icons, {
  192: 'gramWallet/icon-192x192.png',
  256: 'gramWallet/icon-256x256.png',
  512: 'gramWallet/icon-512x512.png',
});
assert.deepEqual(manifest.permissions, [
  'webRequest',
  'system.display',
  'proxy',
  'storage',
  'unlimitedStorage',
]);
assert.deepEqual(manifest.background, { service_worker: '/extensionServiceWorker.js' });
assert.deepEqual(manifest.content_scripts, [{
  matches: ['file://*/*', 'http://*/*', 'https://*/*'],
  js: ['/extensionContentScript.js'],
  run_at: 'document_start',
  all_frames: true,
}]);
assert.deepEqual(manifest.web_accessible_resources, [{
  resources: ['/extensionPageScript.js'],
  matches: ['file://*/*', 'http://*/*', 'https://*/*'],
}]);

for (const requiredPath of [
  'extensionServiceWorker.js',
  'extensionContentScript.js',
  'extensionPageScript.js',
  ...Object.values(manifest.icons),
]) {
  assert.ok(entrySet.has(requiredPath), `${requiredPath} is missing from the package`);
}

const javaScript = unzip(['-p', archivePath, '*.js']);
assert.match(javaScript, /["'`]tonwallet-global-state["'`]/, 'Gram persisted storage key is missing');
assert.doesNotMatch(javaScript, /["'`]mytonwallet-global-state["'`]/, 'Foreign persisted storage key in Gram package');
validateArchiveProductionEndpoints(archivePath);

console.log(`Validated Gram Wallet Chrome package ${archivePath} (${expectedVersion}).`);
