import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const validatorPath = path.join(root, 'scripts/validate-chrome.mjs');
const publisherPath = path.join(root, 'scripts/publish-chrome.sh');
const testBash = process.env.TEST_BASH || 'bash';

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function createPackage(manifest, bundleText) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'gram-chrome-package-'));
  fs.writeFileSync(path.join(fixture, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(fixture, 'extensionServiceWorker.js'), bundleText);
  fs.writeFileSync(path.join(fixture, 'extensionContentScript.js'), 'content');
  fs.writeFileSync(path.join(fixture, 'extensionPageScript.js'), 'page');
  fs.mkdirSync(path.join(fixture, 'gramWallet'));
  for (const size of [192, 256, 512]) {
    fs.writeFileSync(path.join(fixture, `gramWallet/icon-${size}x${size}.png`), 'icon');
  }

  const archive = path.join(fixture, 'GramWallet-chrome-26.9.10.zip');
  const zip = spawnSync('zip', ['-q', '-r', archive, '.'], { cwd: fixture, encoding: 'utf8' });
  assert.equal(zip.status, 0, zip.stderr);
  return archive;
}

function removePackage(archive) {
  fs.rmSync(path.dirname(archive), { recursive: true, force: true });
}

const approvedConnectSources = [
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
];

const validManifest = {
  manifest_version: 3,
  name: 'Gram Wallet',
  description: 'Set up your own Gram Wallet on The Open Network',
  version: '26.9.10',
  icons: {
    192: 'gramWallet/icon-192x192.png',
    256: 'gramWallet/icon-256x256.png',
    512: 'gramWallet/icon-512x512.png',
  },
  action: { default_title: 'Gram Wallet' },
  permissions: ['webRequest', 'system.display', 'proxy', 'storage', 'unlimitedStorage'],
  background: { service_worker: '/extensionServiceWorker.js' },
  content_scripts: [{
    matches: ['file://*/*', 'http://*/*', 'https://*/*'],
    js: ['/extensionContentScript.js'],
    run_at: 'document_start',
    all_frames: true,
  }],
  web_accessible_resources: [{
    resources: ['/extensionPageScript.js'],
    matches: ['file://*/*', 'http://*/*', 'https://*/*'],
  }],
  content_security_policy: {
    extension_pages: [
      "default-src 'none';",
      "manifest-src 'self';",
      `connect-src ${approvedConnectSources.join(" ")};`,
      "script-src 'self' 'wasm-unsafe-eval';",
      "style-src 'self' https://fonts.googleapis.com/;",
      "img-src 'self' data: blob: https: https://static.mytonwallet.org https://imgproxy.mytonwallet.org https://dns-image.mytonwallet.org https://mytonwallet.s3.eu-central-1.amazonaws.com https://cache.tonapi.io https://c.tonapi.io https://web-api.changelly.com;",
      "media-src 'self' data: https://static.mytonwallet.org/;",
      "object-src 'none';",
      "base-uri 'none';",
      "font-src 'self' https://fonts.gstatic.com/;",
      "form-action 'none';",
      "frame-src 'self' https: https://buy-sandbox.moonpay.com/ https://buy.moonpay.com/ https://sell.moonpay.com/ https://sell-sandbox.moonpay.com/ https://*.onetrust.com/ https://dreamwalkers.io/ https://avanchange.com/ https://pay.walletconnect.com/ http://localhost:* https://tonscan.org https://testnet.tonscan.org https://tonviewer.com https://testnet.tonviewer.com https://*.mywallet.io;",
    ].join(' '),
  },
};

test('Gram package validator accepts the expected identity and persisted storage key', () => {
  const archive = createPackage(validManifest, 'const key = "tonwallet-global-state";');
  const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });

  try {
    assert.equal(result.status, 0, result.stderr);
  } finally {
    removePackage(archive);
  }
});

test('Gram package validator rejects permission drift alone', () => {
  const manifest = structuredClone(validManifest);
  manifest.permissions.push('tabs');
  const archive = createPackage(manifest, 'const key = "tonwallet-global-state";');
  const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });

  try {
    assert.notEqual(result.status, 0);
  } finally {
    removePackage(archive);
  }
});

test('Gram package validator rejects storage-key drift alone', () => {
  const archive = createPackage(validManifest, 'const key = "mytonwallet-global-state";');
  try {
    const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /persisted storage key is missing/);
  } finally {
    removePackage(archive);
  }
});

for (const directive of [
  'default-src', 'manifest-src', 'script-src', 'style-src', 'img-src', 'media-src',
  'object-src', 'base-uri', 'font-src', 'form-action', 'frame-src',
]) {
  test(`Gram package validator rejects weakened ${directive} independently`, () => {
    const manifest = structuredClone(validManifest);
    manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages
      .replace(new RegExp(`${directive} [^;]+;`), `${directive} *;`);
    const archive = createPackage(manifest, 'const key = "tonwallet-global-state";');
    try {
      const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(directive));
    } finally {
      removePackage(archive);
    }
  });
}

for (const [name, transform] of [
  ['legacy string', (policy) => policy.extension_pages],
  ['extra sandbox policy', (policy) => ({ ...policy, sandbox: "script-src *" })],
  ['missing script directive', (policy) => ({
    extension_pages: policy.extension_pages.replace(/script-src [^;]+;/, ''),
  })],
  ['extra script directive', (policy) => ({ extension_pages: `${policy.extension_pages} script-src-elem https:;` })],
  ['duplicate connect directive', (policy) => ({ extension_pages: `${policy.extension_pages} connect-src 'self';` })],
]) {
  test(`Gram package validator rejects CSP ${name}`, () => {
    const manifest = { ...validManifest, content_security_policy: transform(validManifest.content_security_policy) };
    const archive = createPackage(manifest, 'const key = "tonwallet-global-state";');
    try {
      const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /CSP/);
    } finally {
      removePackage(archive);
    }
  });
}

for (const [field, value] of Object.entries({
  host_permissions: ['https://example.com/*'],
  optional_permissions: ['tabs'],
  optional_host_permissions: ['https://example.com/*'],
  externally_connectable: { matches: ['https://example.com/*'] },
})) {
  test(`Gram package validator rejects added ${field}`, () => {
    const archive = createPackage({ ...validManifest, [field]: value }, 'const key = "tonwallet-global-state";');
    try {
      const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `Package accepted added capability ${field}`);
      assert.match(result.stderr, /manifest keys/i);
    } finally {
      removePackage(archive);
    }
  });
}

test('Gram package validator rejects changed download bytes against the build digest', () => {
  const archive = createPackage(validManifest, 'const key = "tonwallet-global-state";');
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  try {
    const original = spawnSync(process.execPath, [validatorPath, archive, '26.9.10', digest], {
      encoding: 'utf8',
    });
    assert.equal(original.status, 0, original.stderr);
    for (const invalidDigest of ['', 'not-a-digest', digest.slice(1)]) {
      const invalid = spawnSync(process.execPath, [validatorPath, archive, '26.9.10', invalidDigest], {
        encoding: 'utf8',
      });
      assert.notEqual(invalid.status, 0, 'A missing or malformed expected digest must fail');
      assert.match(invalid.stderr, /SHA-256/);
    }
    fs.appendFileSync(archive, 'changed-after-build');
    const changed = spawnSync(process.execPath, [validatorPath, archive, '26.9.10', digest], {
      encoding: 'utf8',
    });
    assert.notEqual(changed.status, 0, 'A changed archive must fail before publication');
    assert.match(changed.stderr, /SHA-256/);
  } finally {
    removePackage(archive);
  }
});

test('Gram package validator rejects a poisoned first-party endpoint', () => {
  const archive = createPackage(
    validManifest,
    'const key = "tonwallet-global-state"; const endpoint = "https://beta-api.mytonwallet.org";',
  );
  const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });

  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /beta-api\.mytonwallet\.org/);
  } finally {
    removePackage(archive);
  }
});

test('Gram package validator rejects a non-allowlisted connect-src origin', () => {
  const manifest = structuredClone(validManifest);
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages
    .replace(/connect-src [^;]+;/, "connect-src 'self' https://evil.example;");
  const archive = createPackage(manifest, 'const key = "tonwallet-global-state";');
  const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });

  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /evil\.example/);
  } finally {
    removePackage(archive);
  }
});


test('Gram package validator rejects mixed wallet storage keys', () => {
  const archive = createPackage(validManifest, 'const gram = "tonwallet-global-state"; const other = "mytonwallet-global-state";');
  try {
    const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Mixed-wallet ZIP must not pass');
  } finally { removePackage(archive); }
});

for (const source of approvedConnectSources) {
  test(`Gram package validator requires connect-src ${source}`, () => {
    const manifest = structuredClone(validManifest);
    manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages
      .replace(/connect-src [^;]+;/, `connect-src ${approvedConnectSources.filter((value) => value !== source).join(' ')};`);
    const archive = createPackage(manifest, 'const key = "tonwallet-global-state";');
    try {
      const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `Missing required source ${source} must fail`);
    } finally { removePackage(archive); }
  });
}

test('Gram package validator rejects duplicate connect-src tokens', () => {
  const manifest = structuredClone(validManifest);
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace("connect-src 'self'", "connect-src 'self' 'self'");
  const archive = createPackage(manifest, 'const key = "tonwallet-global-state";');
  try {
    const result = spawnSync(process.execPath, [validatorPath, archive, '26.9.10'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Duplicate CSP source must fail');
  } finally { removePackage(archive); }
});

const extensionId = 'nphplpgoakhhjchkkhmiggakijnkhfnd';
const candidateVersion = '26.9.10';
const candidateChannel = { crxVersion: candidateVersion, deployPercentage: 5 };
const initialStoreStatus = {
  itemId: extensionId,
  takenDown: false,
  warned: false,
  publishedItemRevisionStatus: {
    state: 'PUBLISHED', distributionChannels: [{ crxVersion: '4.0.7', deployPercentage: 100 }],
  },
};

function createStore(t, config = {}) {
  const archive = createPackage(validManifest, 'const key = "tonwallet-global-state";');
  const directory = path.dirname(archive);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  const build = {
    schemaVersion: 1,
    sourceRepository: 'mytonwallet-org/mytonwallet', sourceSha: '1'.repeat(40), version: candidateVersion,
    controlRepository: 'ton-blockchain/ton-wallet', controlSha: '2'.repeat(40),
    workflowRunId: '200', workflowRunAttempt: '1', archiveName: path.basename(archive),
    archiveSha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), extensionId,
    webArchiveName: 'GramWallet-web-26.9.10.tar', webArchiveSha256: '3'.repeat(64),
  };
  const buildPath = path.join(directory, 'build-receipt.json');
  const outputPath = path.join(directory, 'store-receipt.json');
  fs.writeFileSync(buildPath, JSON.stringify(build));
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(directory, 'status.json'), JSON.stringify(config.initialStatus || initialStoreStatus));
  fs.writeFileSync(path.join(bin, 'curl'), `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const dir = process.env.FAKE_STORE_DIR;
const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json')));
const statePath = path.join(dir, 'status.json');
const state = JSON.parse(fs.readFileSync(statePath));
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const url = args.at(-1);
const data = args.includes('--data') ? JSON.parse(value('--data')) : undefined;
fs.appendFileSync(path.join(dir, 'requests.jsonl'), JSON.stringify({ url, data }) + '\\n');
let result;
let operation;
if (url.endsWith('/token')) {
  result = config.token || { access_token: 'access-token', scope: 'https://www.googleapis.com/auth/chromewebstore' };
} else if (url.endsWith(':fetchStatus')) {
  result = state;
} else if (url.endsWith(':upload')) {
  operation = 'upload';
  result = config.upload || { itemId: '${extensionId}', crxVersion: '${candidateVersion}', uploadState: 'SUCCEEDED' };
  state.lastAsyncUploadState = config.asyncUploadState || 'SUCCEEDED';
} else if (url.endsWith(':publish')) {
  operation = data.publishType === 'STAGED_PUBLISH' ? 'stage' : 'promote';
  const expectedState = operation === 'stage' ? 'PENDING_REVIEW' : 'PUBLISHED';
  result = { itemId: '${extensionId}', state: config.publishState || expectedState };
  if (operation === 'stage') {
    state.submittedItemRevisionStatus = config.submitted || { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '${candidateVersion}', deployPercentage: data.deployInfos[0].deployPercentage }] };
    if (config.publishedDuringStage) state.publishedItemRevisionStatus = config.publishedDuringStage;
  } else {
    state.publishedItemRevisionStatus = config.promoted || { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '${candidateVersion}', deployPercentage: data.deployInfos[0].deployPercentage }] };
    delete state.submittedItemRevisionStatus;
  }
} else if (url.endsWith(':setPublishedDeployPercentage')) {
  operation = 'rollout';
  state.publishedItemRevisionStatus.distributionChannels[0].deployPercentage = config.rolloutReadback || data.deployPercentage;
  result = {};
} else { process.exit(2); }
fs.writeFileSync(statePath, JSON.stringify(state));
if (operation && operation === config.failOperation) process.exit(52);
fs.writeFileSync(value('--output'), JSON.stringify(result));
`);
  fs.chmodSync(path.join(bin, 'curl'), 0o755);
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(bin, 'sleep'), 0o755);
  const githubMock = path.join(directory, 'github-fetch.mjs');
  fs.writeFileSync(githubMock, `
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_STORE_DIR;
globalThis.fetch = async (url, options = {}) => {
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json')));
  fs.appendFileSync(path.join(dir, 'requests.jsonl'), JSON.stringify({ url }) + '\\n');
  let value;
  if (url.endsWith('/git/tags') && options.method === 'POST') {
    value = { sha: '4'.repeat(40) };
  } else if (url.endsWith('/git/refs') && options.method === 'POST') {
    const marker = path.join(dir, 'claimed');
    if (fs.existsSync(marker)) return { ok: false, status: 422 };
    fs.writeFileSync(marker, 'claimed');
    if (config.uncertainClaim) return { ok: false, status: 503 };
    value = {};
  } else if (url.includes('/git/ref/tags/gram-chrome-stage-v')) {
    value = { ref: 'refs/tags/gram-chrome-stage-v${candidateVersion}', object: { type: 'tag', sha: '4'.repeat(40) } };
  } else if (url.endsWith('/commits/master')) {
    const requests = fs.readFileSync(path.join(dir, 'requests.jsonl'), 'utf8').trim().split('\\n').map(JSON.parse);
    const stale = config.staleInitially || (config.staleAfterUpload && requests.some(({ url }) => url.endsWith(':upload')));
    value = { sha: stale ? '9'.repeat(40) : '1'.repeat(40) };
  } else if (url.includes('/compare/')) {
    value = { status: 'identical', merge_base_commit: { sha: '1'.repeat(40) } };
  } else if (url.includes('/contents/')) {
    value = { type: 'file', encoding: 'base64', content: Buffer.from(url.includes('/package.json?') ? JSON.stringify({ version: '${candidateVersion}' }) : '${candidateVersion}\\n').toString('base64') };
  } else if (url === 'https://api.github.com/repos/mytonwallet-org/mytonwallet') {
    value = { full_name: 'mytonwallet-org/mytonwallet', private: false, default_branch: 'master' };
  } else { throw new Error('Unexpected GitHub request'); }
  return { ok: true, status: 200, json: async () => value };
};
`);
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_STORE_DIR: directory,
    NODE_OPTIONS: `--import=${githubMock}`,
    GITHUB_REPOSITORY: 'ton-blockchain/ton-wallet', GITHUB_REF: 'refs/heads/master',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GRAM_RELEASE_ENABLED: 'true', GH_TOKEN: 'hidden-github-token',
    GITHUB_SHA: '2'.repeat(40), RELEASE_SOURCE_SHA: '1'.repeat(40), RELEASE_VERSION: candidateVersion,
    EXTENSION_ID: extensionId, PUBLISHER_ID: 'publisher', GITHUB_RUN_ID: '200', GITHUB_RUN_ATTEMPT: '2',
    GOOGLE_CLIENT_ID: 'hidden-client', GOOGLE_CLIENT_SECRET: 'hidden-secret', GOOGLE_REFRESH_TOKEN: 'hidden-refresh',
  };
  const run = (...args) => spawnSync(testBash, [publisherPath, ...args], { encoding: 'utf8', env });
  const requests = () => fs.existsSync(path.join(directory, 'requests.jsonl'))
    ? read(path.join(directory, 'requests.jsonl')).trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const receipt = (operation = 'stage', overrides = {}) => ({
    schemaVersion: 1, operation, success: true, build, publisherId: 'publisher', rolloutPercentage: 5,
    state: operation === 'stage' ? 'STAGED' : 'PUBLISHED', operationRunId: '101', operationRunAttempt: '1', ...overrides,
  });
  const input = (value) => {
    const name = path.join(directory, 'input-receipt.json');
    fs.writeFileSync(name, JSON.stringify(value));
    return name;
  };
  return { directory, archive, build, buildPath, outputPath, env, run, requests, receipt, input };
}

function assertSuccess(result) { assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); }
function assertFailure(result) { assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`); }
function mutations(store) { return store.requests().filter(({ url }) => /:(upload|publish|setPublishedDeployPercentage)$/.test(url)); }
function stagedStatus(channels = [candidateChannel], state = 'STAGED') {
  return { ...initialStoreStatus, submittedItemRevisionStatus: { state, distributionChannels: channels } };
}
function publishedStatus(channels = [candidateChannel], state = 'PUBLISHED') {
  return { ...initialStoreStatus, publishedItemRevisionStatus: { state, distributionChannels: channels } };
}

test('preflight is read-only and rejects invalid rollout before networking', (t) => {
  const store = createStore(t);
  for (const percentage of ['', '0', '101', '5.5', 'five']) assertFailure(store.run('preflight', candidateVersion, percentage));
  assert.deepEqual(store.requests(), []);
  assertSuccess(store.run('preflight', candidateVersion, '5'));
  assert.deepEqual(mutations(store), []);
});

for (const version of ['4.0.7', '1', '0.0.0.0', '26.09.10', '65536.1', 'not-a-version']) {
  test(`preflight rejects stale or invalid Chrome version ${version}`, (t) => {
    const store = createStore(t);
    assertFailure(store.run('preflight', version, '5'));
    assert.deepEqual(mutations(store), []);
  });
}

for (const scope of ['', 'https://www.googleapis.com/auth/chromewebstore.readonly']) {
  test(`preflight rejects missing full OAuth scope ${scope}`, (t) => {
    const store = createStore(t, { token: { access_token: 'access-token', scope } });
    assertFailure(store.run('preflight', candidateVersion, '5'));
    assert.equal(store.requests().length, 1);
  });
}

test('stage uploads exact ZIP and records its complete receipt after staged readback', (t) => {
  const store = createStore(t);
  const result = store.run('stage', store.archive, store.buildPath, '5', store.outputPath);
  assertSuccess(result);
  const requests = mutations(store);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /:upload$/);
  assert.deepEqual(requests[1].data, {
    publishType: 'STAGED_PUBLISH', deployInfos: [{ deployPercentage: 5 }], skipReview: false, blockOnWarnings: true,
  });
  assert.deepEqual(JSON.parse(read(store.outputPath)), store.receipt('stage', {
    state: 'PENDING_REVIEW', operationRunId: '200', operationRunAttempt: '2',
  }));
  assert.doesNotMatch(`${result.stdout}${result.stderr}${read(store.outputPath)}`, /hidden-client|hidden-secret|hidden-refresh|access-token/);
});

test('stage waits for asynchronous upload and accepts fast approval', (t) => {
  const store = createStore(t, {
    upload: { itemId: extensionId, uploadState: 'IN_PROGRESS' }, publishState: 'STAGED',
    submitted: { state: 'STAGED', distributionChannels: [candidateChannel] },
  });
  assertSuccess(store.run('stage', store.archive, store.buildPath, '5', store.outputPath));
  assert.equal(JSON.parse(read(store.outputPath)).state, 'STAGED');
});

for (const change of [
  { sourceRepository: 'mytonwallet-org/mytonwallet-dev' }, { sourceSha: 'master' }, { controlSha: 'main' },
  { controlRepository: 'someone/else' }, { archiveSha256: '0'.repeat(64) }, { extensionId: 'other' },
  { workflowRunId: 100 }, { workflowRunAttempt: '' }, { archiveName: '../package.zip' },
]) {
  test(`stage rejects invalid build receipt ${Object.keys(change)[0]} before credentials are used`, (t) => {
    const store = createStore(t);
    fs.writeFileSync(store.buildPath, JSON.stringify({ ...store.build, ...change }));
    assertFailure(store.run('stage', store.archive, store.buildPath, '5', store.outputPath));
    assert.deepEqual(store.requests(), []);
  });
}

for (const [name, status] of [
  ['pending review', stagedStatus([candidateChannel], 'PENDING_REVIEW')], ['staged', stagedStatus()],
  ['same version published', publishedStatus()], ['newer version published', publishedStatus([{ crxVersion: '26.9.11', deployPercentage: 100 }])],
  ['taken down', { ...initialStoreStatus, takenDown: true }], ['warned partial', { ...initialStoreStatus, warned: true }],
]) {
  test(`stage refuses ${name} without upload or cancellation`, (t) => {
    const store = createStore(t, { initialStatus: status });
    assertFailure(store.run('stage', store.archive, store.buildPath, '5', store.outputPath));
    assert.deepEqual(mutations(store), []);
  });
}

for (const parentState of ['PUBLISHED', 'STAGED', 'UNKNOWN', undefined]) {
  test(`stage rejects candidate in published channels even with parent state ${parentState}`, (t) => {
    const store = createStore(t, { publishedDuringStage: { state: parentState, distributionChannels: [candidateChannel] } });
    assertFailure(store.run('stage', store.archive, store.buildPath, '5', store.outputPath));
    assert.equal(JSON.parse(read(store.outputPath)).success, false);
  });
}

for (const [name, config] of [
  ['upload version mismatch', { upload: { itemId: extensionId, uploadState: 'SUCCEEDED', crxVersion: '26.9.11' } }],
  ['upload item mismatch', { upload: { itemId: 'other', uploadState: 'SUCCEEDED', crxVersion: candidateVersion } }],
  ['unexpected published response', { publishState: 'PUBLISHED' }],
  ['wrong staged percentage', { submitted: { state: 'STAGED', distributionChannels: [{ ...candidateChannel, deployPercentage: 10 }] } }],
  ['ambiguous upload response', { failOperation: 'upload' }], ['ambiguous submit response', { failOperation: 'stage' }],
]) {
  test(`stage does not issue a success receipt for ${name}`, (t) => {
    const store = createStore(t, config);
    assertFailure(store.run('stage', store.archive, store.buildPath, '5', store.outputPath));
    assert.equal(JSON.parse(read(store.outputPath)).success, false);
    assert.ok(mutations(store).length <= 2);
  });
}

test('promote activates only the recorded staged version and never uploads', (t) => {
  const store = createStore(t, { initialStatus: stagedStatus() });
  assertSuccess(store.run('promote', store.input(store.receipt()), store.outputPath));
  assert.equal(mutations(store).length, 1);
  assert.deepEqual(mutations(store)[0].data, {
    publishType: 'DEFAULT_PUBLISH', deployInfos: [{ deployPercentage: 5 }], skipReview: false, blockOnWarnings: true,
  });
  const receipt = JSON.parse(read(store.outputPath));
  assert.equal(receipt.operation, 'promote');
  assert.equal(receipt.state, 'PUBLISHED');
  assert.deepEqual(receipt.build, store.build);
});

for (const changes of [{ success: false }, { operation: 'promote' }, { publisherId: 'another' }, { state: 'PUBLISHED' }, { operationRunId: '' }]) {
  test(`promote rejects untrusted stage receipt ${Object.keys(changes)[0]}`, (t) => {
    const store = createStore(t, { initialStatus: stagedStatus() });
    assertFailure(store.run('promote', store.input(store.receipt('stage', changes)), store.outputPath));
    assert.deepEqual(store.requests(), []);
  });
}

for (const status of [
  stagedStatus([candidateChannel], 'PENDING_REVIEW'),
  stagedStatus([{ ...candidateChannel, crxVersion: '26.9.11' }]),
  stagedStatus([{ ...candidateChannel, deployPercentage: 10 }]), publishedStatus(),
]) {
  test(`promote refuses unapproved or conflicting remote state ${JSON.stringify(status)}`, (t) => {
    const store = createStore(t, { initialStatus: status });
    assertFailure(store.run('promote', store.input(store.receipt()), store.outputPath));
    assert.deepEqual(mutations(store), []);
  });
}

test('rollout increases only the recorded published version and verifies percentage', (t) => {
  const store = createStore(t, { initialStatus: publishedStatus() });
  assertSuccess(store.run('rollout', store.input(store.receipt('promote')), '25', store.outputPath));
  assert.equal(mutations(store).length, 1);
  assert.match(mutations(store)[0].url, /:setPublishedDeployPercentage$/);
  assert.deepEqual(mutations(store)[0].data, { deployPercentage: 25 });
  const receipt = JSON.parse(read(store.outputPath));
  assert.equal(receipt.operation, 'rollout');
  assert.equal(receipt.rolloutPercentage, 25);
  assert.equal(receipt.success, true);
});

for (const percentage of ['1', '5', '0', '101']) {
  test(`rollout refuses decrease, repeat or invalid target ${percentage}`, (t) => {
    const store = createStore(t, { initialStatus: publishedStatus() });
    assertFailure(store.run('rollout', store.input(store.receipt('promote')), percentage, store.outputPath));
    assert.deepEqual(mutations(store), []);
  });
}

for (const config of [
  { initialStatus: publishedStatus([{ ...candidateChannel, crxVersion: '26.9.11' }]) },
  { initialStatus: publishedStatus([candidateChannel], 'STAGED') },
  { initialStatus: publishedStatus(), failOperation: 'rollout' },
  { initialStatus: publishedStatus(), rolloutReadback: 10 },
]) {
  test(`rollout fails closed for state or response mismatch ${JSON.stringify(config)}`, (t) => {
    const store = createStore(t, config);
    assertFailure(store.run('rollout', store.input(store.receipt('promote')), '25', store.outputPath));
    assert.equal(JSON.parse(read(store.outputPath)).success, false);
    assert.ok(mutations(store).length <= 1);
  });
}

function createWeb(t, mutate = () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gram-web-policy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'gramWallet'));
  fs.writeFileSync(path.join(directory, 'gramWallet/site.webmanifest'), JSON.stringify({
    name: 'Gram Wallet', short_name: 'Gram Wallet', start_url: '/',
  }));
  fs.writeFileSync(path.join(directory, 'index.html'), `<html data-global-state-key="tonwallet-global-state"><head><title>Gram Wallet</title><meta http-equiv="Content-Security-Policy" content="${validManifest.content_security_policy.extension_pages}"></head></html>`);
  fs.writeFileSync(path.join(directory, 'app.js'), 'const key = "tonwallet-global-state";');
  fs.writeFileSync(path.join(directory, 'version.txt'), candidateVersion);
  fs.writeFileSync(path.join(directory, 'build.txt'), `version=${candidateVersion}\ncommit=${'1'.repeat(40)}\nenv=production\n`);
  mutate(directory);
  return spawnSync(process.execPath, [path.join(root, 'scripts/validate-web.mjs'), directory, candidateVersion], { encoding: 'utf8' });
}

test('web policy accepts production Gram identity and version metadata', (t) => assertSuccess(createWeb(t)));
for (const [name, mutate] of [
  ['wrong version', (dir) => fs.writeFileSync(path.join(dir, 'version.txt'), '26.9.9')],
  ['wrong build environment', (dir) => fs.writeFileSync(path.join(dir, 'build.txt'), `version=${candidateVersion}\nenv=staging\n`)],
  ['wrong manifest brand', (dir) => fs.writeFileSync(path.join(dir, 'gramWallet/site.webmanifest'), '{"name":"My Wallet"}')],
  ['legacy page title', (dir) => fs.writeFileSync(path.join(dir, 'index.html'), '<title>TON Wallet</title>')],
  ['missing Gram key', (dir) => fs.writeFileSync(path.join(dir, 'app.js'), 'const key = "other";')],
  ['mixed storage keys', (dir) => fs.appendFileSync(path.join(dir, 'app.js'), 'const old = "mytonwallet-global-state";')],
  ['nonproduction endpoint', (dir) => fs.appendFileSync(path.join(dir, 'app.js'), 'const api = "https://beta-api.mytonwallet.org";')],
]) {
  test(`web policy rejects ${name}`, (t) => assertFailure(createWeb(t, mutate)));
}


test('stage refuses an existing operation receipt before overwriting evidence or networking', (t) => {
  const store = createStore(t);
  const original = JSON.stringify({ success: false, phase: 'upload-requested' });
  fs.writeFileSync(store.outputPath, original);
  assertFailure(store.run('stage', store.archive, store.buildPath, '5', store.outputPath));
  assert.equal(read(store.outputPath), original);
  assert.deepEqual(store.requests(), []);
});

for (const [name, config, mutationCount] of [['upload', { staleInitially: true }, 0], ['submission', { staleAfterUpload: true }, 1]]) {
  test(`stage checks latest source immediately before ${name}`, (t) => {
    const store = createStore(t, config);
    assertFailure(store.run('stage', store.archive, store.buildPath, '5', store.outputPath));
    assert.equal(mutations(store).length, mutationCount);
    assert.equal(JSON.parse(read(store.outputPath)).success, false);
  });
}


test('uncertain durable claim blocks this upload and a later invocation of the same version', (t) => {
  const store = createStore(t, { uncertainClaim: true });
  assertFailure(store.run('stage', store.archive, store.buildPath, '5', store.outputPath));
  assert.deepEqual(mutations(store), []);
  fs.writeFileSync(path.join(store.directory, 'config.json'), '{}');
  const nextOutput = path.join(store.directory, 'next-store-receipt.json');
  assertFailure(store.run('stage', store.archive, store.buildPath, '5', nextOutput));
  assert.deepEqual(mutations(store), []);
  assert.equal(JSON.parse(read(nextOutput)).success, false);
});

test('accepted upload with lost response cannot be uploaded again from a later attempt', (t) => {
  const store = createStore(t, { failOperation: 'upload' });
  const first = store.run('stage', store.archive, store.buildPath, '5', store.outputPath);
  assertFailure(first);
  assert.equal(mutations(store).length, 1);
  assert.match(mutations(store)[0].url, /:upload$/);
  fs.writeFileSync(path.join(store.directory, 'config.json'), '{}');
  store.env.GITHUB_RUN_ATTEMPT = '3';
  const retryOutput = path.join(store.directory, 'retry-store-receipt.json');
  const retry = store.run('stage', store.archive, store.buildPath, '5', retryOutput);
  assertFailure(retry);
  assert.match(retry.stderr, /claim was not confirmed/);
  assert.equal(mutations(store).length, 1, 'The uncertain ZIP must not be uploaded or submitted again');
  assert.equal(JSON.parse(read(retryOutput)).success, false);
});

for (const config of [
  { initialStatus: stagedStatus(), failOperation: 'promote' },
  { initialStatus: stagedStatus(), promoted: { state: 'PUBLISHED', distributionChannels: [{ ...candidateChannel, deployPercentage: 10 }] } },
  { initialStatus: stagedStatus(), publishState: 'PENDING_REVIEW' },
]) {
  test(`promotion failure cannot produce a successful receipt ${JSON.stringify(config)}`, (t) => {
    const store = createStore(t, config);
    assertFailure(store.run('promote', store.input(store.receipt()), store.outputPath));
    assert.equal(JSON.parse(read(store.outputPath)).success, false);
    assert.equal(mutations(store).length, 1);
  });
}

test('rollout rejects a newer published channel even when the recorded channel remains present', (t) => {
  const store = createStore(t, {
    initialStatus: publishedStatus([candidateChannel, { crxVersion: '26.9.11', deployPercentage: 5 }]),
  });
  assertFailure(store.run('rollout', store.input(store.receipt('promote')), '25', store.outputPath));
  assert.deepEqual(mutations(store), []);
});
