#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { validateDirectoryProductionEndpoints } from './validate-endpoints.mjs';

const [directory, expectedVersion] = process.argv.slice(2);
assert.ok(directory && expectedVersion, 'Usage: validate-web.mjs <directory> <expected-version>');
const read = (name) => fs.readFileSync(path.join(directory, name), 'utf8');
const html = read('index.html');
assert.match(html, /<title>\s*Gram Wallet\s*<\/title>/, 'Gram page title is missing');
assert.doesNotMatch(html, /TON Wallet/, 'Legacy branding remains in the Gram page');
assert.match(html, /data-global-state-key=["']tonwallet-global-state["']/, 'Gram page storage key is missing');

const manifest = JSON.parse(read('gramWallet/site.webmanifest'));
assert.equal(manifest.name, 'Gram Wallet', 'Web manifest has the wrong brand');
assert.equal(manifest.short_name, 'Gram Wallet', 'Web manifest has the wrong short name');
assert.equal(manifest.start_url, '/', 'Web manifest start URL changed');
assert.equal(read('version.txt').trim(), expectedVersion, 'Web artifact version differs from the release');
const buildLines = read('build.txt').trim().split('\n');
assert.equal(buildLines.filter((line) => line.startsWith('version=')).join(), `version=${expectedVersion}`);
assert.equal(buildLines.filter((line) => line.startsWith('env=')).join(), 'env=production');

const javaScript = fs.readdirSync(directory)
  .filter((name) => name.endsWith('.js'))
  .map(read)
  .join('\n');
assert.match(javaScript, /["'`]tonwallet-global-state["'`]/, 'Gram persisted storage key is missing');
assert.doesNotMatch(javaScript, /["'`]mytonwallet-global-state["'`]/, 'Foreign persisted storage key in Gram Web');
validateDirectoryProductionEndpoints(directory, path.join(directory, 'index.html'));
console.log(`Validated Gram Web ${expectedVersion} in ${directory}.`);
