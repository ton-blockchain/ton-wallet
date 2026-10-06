#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED_CONNECT_SRC = new Set([
  "'self'",
  'blob:',
  'https://*.walletconnect.com',
  'https://*.walletconnect.org',
  'https://agent.mywallet.io',
  'https://analytics.ton.org',
  'https://api-portfolio.mywallet.io/api/',
  'https://api.mywallet.io',
  'https://api.mywallet.io/proxy/',
  'https://api.pay.walletconnect.com/',
  'https://api.pay.walletconnect.org/',
  'https://api.shasta.trongrid.io',
  'https://evmapi-testnet.mytonwallet.org',
  'https://evmapi.mytonwallet.org',
  'https://ipfs.io/ipfs/',
  'https://mfa-server.mytonwallet.org',
  'https://pay.walletconnect.com/',
  'https://solanaapi-devnet.mytonwallet.org',
  'https://solanaapi.mytonwallet.org',
  'https://staging.api.pay.walletconnect.org/',
  'https://static.mytonwallet.org',
  'https://tonapiio-testnet.mytonwallet.org',
  'https://tonapiio.mytonwallet.org',
  'https://toncenter-testnet.mytonwallet.org',
  'https://toncenter.mytonwallet.org',
  'https://tonconnectbridge.mytonwallet.org/bridge/',
  'https://tronapi.mytonwallet.org',
  'https://utxoapi-testnet.mytonwallet.org',
  'https://utxoapi.mytonwallet.org',
  'wss://*.walletconnect.com',
  'wss://*.walletconnect.org',
  'wss://api.mywallet.io',
  'wss://evmapi-testnet.mytonwallet.org',
  'wss://evmapi.mytonwallet.org',
  'wss://solanaapi-devnet.mytonwallet.org',
  'wss://solanaapi.mytonwallet.org',
  'wss://toncenter-testnet.mytonwallet.org',
  'wss://toncenter.mytonwallet.org',
  'wss://utxoapi-testnet.mytonwallet.org',
  'wss://utxoapi.mytonwallet.org',
]);

const SCANNED_FILE = /(?:\.(?:js|html|css|json|webmanifest)|(?:^|\/)(?:_redirects|_headers))$/;
const NON_PROD_HOST = /[a-z0-9.-]*(?:beta|staging)[a-z0-9.-]*\.(?:mytonwallet\.(?:org|app|io)|mywallet\.io|gramwallet\.(?:io|app))|[a-z0-9-]+\.netlify\.app/gi;
const NON_PROD_EXEMPTIONS = new Set(['beta.mywallet.io', 'beta.wallet.ton.org']);

export function validateConnectSrc(csp) {
  const connectSrc = csp.match(/\bconnect-src\s+([^;]+)/)?.[1];
  assert.ok(connectSrc, 'No connect-src directive found in the artifact CSP');

  for (const token of connectSrc.trim().split(/\s+/)) {
    assert.ok(
      ALLOWED_CONNECT_SRC.has(token),
      `connect-src contains a host that is not on the production allowlist: ${token}`,
    );
  }
}

function validateArchiveCsp(policy) {
  assert.ok(policy && typeof policy === 'object' && !Array.isArray(policy), 'Extension CSP must be an object');
  assert.deepEqual(Object.keys(policy), ['extension_pages'], 'Extension CSP keys differ from the approved package');
  assert.equal(typeof policy.extension_pages, 'string', 'Extension CSP is missing');

  const expected = {
    'default-src': "'none'",
    'manifest-src': "'self'",
    'script-src': "'self' 'wasm-unsafe-eval'",
    'style-src': "'self' https://fonts.googleapis.com/",
    'img-src': [
      "'self' data: blob: https: https://static.mytonwallet.org",
      'https://imgproxy.mytonwallet.org https://dns-image.mytonwallet.org',
      'https://mytonwallet.s3.eu-central-1.amazonaws.com https://cache.tonapi.io',
      'https://c.tonapi.io https://web-api.changelly.com',
    ].join(' '),
    'media-src': "'self' data: https://static.mytonwallet.org/",
    'object-src': "'none'",
    'base-uri': "'none'",
    'font-src': "'self' https://fonts.gstatic.com/",
    'form-action': "'none'",
    'frame-src': [
      "'self' https: https://buy-sandbox.moonpay.com/ https://buy.moonpay.com/",
      'https://sell.moonpay.com/ https://sell-sandbox.moonpay.com/ https://*.onetrust.com/',
      'https://dreamwalkers.io/ https://avanchange.com/ https://pay.walletconnect.com/',
      'http://localhost:* https://tonscan.org https://testnet.tonscan.org',
      'https://tonviewer.com https://testnet.tonviewer.com https://*.mywallet.io',
    ].join(' '),
  };
  const directives = new Map();
  for (const directive of policy.extension_pages.split(';').map((value) => value.trim()).filter(Boolean)) {
    const [name, ...sources] = directive.split(/\s+/);
    assert.ok(!directives.has(name), `Duplicate extension CSP directive: ${name}`);
    directives.set(name, sources);
  }
  assert.deepEqual(
    [...directives.keys()].sort(),
    [...Object.keys(expected), 'connect-src'].sort(),
    'Extension CSP directives differ from the approved package',
  );
  for (const [name, sources] of Object.entries(expected)) {
    assert.deepEqual(directives.get(name).sort(), sources.split(' ').sort(), `Unexpected extension CSP ${name}`);
  }
  validateConnectSrc(policy.extension_pages);
  assert.deepEqual(
    directives.get('connect-src').sort(),
    [...ALLOWED_CONNECT_SRC].sort(),
    'Extension CSP connect-src differs from the complete production profile',
  );
}

export function validateNoNonProductionHosts(contents) {
  const hits = new Set();
  for (const content of contents) {
    for (const match of content.matchAll(NON_PROD_HOST)) {
      const host = match[0].toLowerCase();
      if (!NON_PROD_EXEMPTIONS.has(host)) hits.add(host);
    }
  }
  assert.equal(
    hits.size,
    0,
    `Non-production first-party hosts found in the artifact: ${[...hits].sort().join(', ')}`,
  );
}

function walkFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(entryPath));
    else files.push(entryPath);
  }
  return files;
}

export function validateDirectoryProductionEndpoints(directory, cspFile) {
  validateConnectSrc(fs.readFileSync(cspFile, 'utf8'));
  validateNoNonProductionHosts(
    walkFiles(directory)
      .filter((filePath) => SCANNED_FILE.test(filePath))
      .map((filePath) => fs.readFileSync(filePath, 'utf8')),
  );
}

export function validateArchiveProductionEndpoints(archivePath) {
  const unzip = (args) => execFileSync('unzip', args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  const entries = unzip(['-Z1', archivePath])
    .trim()
    .split('\n')
    .map((raw) => ({ raw, normalized: raw.replace(/^\.\//, '') }));
  const manifestEntry = entries.find(({ normalized }) => normalized === 'manifest.json');
  assert.ok(manifestEntry, 'manifest.json must be at the package root');

  const manifest = JSON.parse(unzip(['-p', archivePath, manifestEntry.raw]));
  validateArchiveCsp(manifest.content_security_policy);
  validateNoNonProductionHosts(
    entries
      .filter(({ normalized }) => SCANNED_FILE.test(normalized))
      .map(({ raw }) => unzip(['-p', archivePath, raw])),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, artifactPath, cspFile] = process.argv.slice(2);
  if (mode === 'directory' && artifactPath && cspFile) {
    validateDirectoryProductionEndpoints(artifactPath, cspFile);
  } else if (mode === 'archive' && artifactPath) {
    validateArchiveProductionEndpoints(artifactPath);
  } else {
    throw new Error(`Usage: ${process.argv[1]} directory <directory> <csp-file> | archive <archive.zip>`);
  }
  console.log(`Validated production endpoints in ${artifactPath}.`);
}
