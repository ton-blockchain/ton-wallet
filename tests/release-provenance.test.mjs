import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertLatestSource, assertLiveContext, checkSource, githubClient, validateInputs } from '../scripts/source.mjs';
import { createBuildReceipt, selectArtifact, verifyBuildReceipt, verifyOperationReceipt, verifyCurrentBuild, verifyArtifactIdentity, createWebMarker, verifyLiveWeb, assertReleaseResult } from '../scripts/receipts.mjs';

const sourceSha = 'a'.repeat(40);
const controlSha = 'b'.repeat(40);
const sourceRepository = 'mytonwallet-org/mytonwallet';
const controlRepository = 'ton-blockchain/ton-wallet';
const version = '26.9.10';
const extensionId = 'nphplpgoakhhjchkkhmiggakijnkhfnd';
const sourceBase = `/repos/${sourceRepository}`;
const controlBase = `/repos/${controlRepository}`;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Tests cannot reach external services'); };
test.after(() => { globalThis.fetch = originalFetch; });

function api(routes) {
  return githubClient('synthetic', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer synthetic');
    const path = new URL(url).pathname + new URL(url).search;
    assert.ok(Object.hasOwn(routes, path), `Unexpected API request ${path}`);
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  });
}
const content = (value) => ({ type: 'file', encoding: 'base64', content: Buffer.from(value).toString('base64') });
function sourceRoutes(overrides = {}) {
  return {
    [sourceBase]: { full_name: sourceRepository, private: false, default_branch: 'master' },
    [`${sourceBase}/commits/master`]: { sha: sourceSha },
    [`${sourceBase}/compare/${sourceSha}...master`]: { status: 'identical', merge_base_commit: { sha: sourceSha } },
    [`${sourceBase}/contents/package.json?ref=${sourceSha}`]: content(JSON.stringify({ version })),
    [`${sourceBase}/contents/.release?ref=${sourceSha}`]: content(`${version}\n${'c'.repeat(40)}\n`),
    ...overrides,
  };
}
function run(overrides = {}) {
  return { id: 123, run_attempt: 2, status: 'completed', conclusion: 'success', event: 'workflow_dispatch',
    path: '.github/workflows/gram-release.yml', head_branch: 'master', head_sha: controlSha,
    repository: { full_name: controlRepository }, head_repository: { full_name: controlRepository }, ...overrides };
}
function artifact(overrides = {}) {
  return { id: 789, name: 'gram-stage-123-2', expired: false,
    workflow_run: { id: 123, head_sha: controlSha }, ...overrides };
}
const build = { schemaVersion: 1, sourceRepository, sourceSha, version, controlRepository, controlSha,
  workflowRunId: '123', workflowRunAttempt: '2', archiveName: `GramWallet-chrome-${version}.zip`,
  archiveSha256: createHash('sha256').update('valid zip fixture').digest('hex'), extensionId,
  webArchiveName: `GramWallet-web-${version}.tar`,
  webArchiveSha256: createHash('sha256').update('valid web fixture').digest('hex') };
const stage = { schemaVersion: 1, operation: 'stage', success: true, build,
  operationRunId: '123', operationRunAttempt: '2', rolloutPercentage: 5, state: 'STAGED' };

test('source check accepts only the public master lineage and matching release files', async () => {
  assert.deepEqual(await checkSource(sourceSha, version, api(sourceRoutes())), { sourceSha, version });
  for (const overrides of [
    { [sourceBase]: { full_name: sourceRepository, private: true, default_branch: 'master' } },
    { [`${sourceBase}/compare/${sourceSha}...master`]: { status: 'diverged', merge_base_commit: { sha: 'd'.repeat(40) } } },
    { [`${sourceBase}/contents/package.json?ref=${sourceSha}`]: content('{"version":"26.9.11"}') },
    { [`${sourceBase}/contents/.release?ref=${sourceSha}`]: content('26.9.11\n') },
  ]) await assert.rejects(checkSource(sourceSha, version, api(sourceRoutes(overrides))));
});

test('historical public source may be checked but cannot publish after master advances', async () => {
  const routes = sourceRoutes({
    [`${sourceBase}/commits/master`]: { sha: 'd'.repeat(40) },
    [`${sourceBase}/compare/${sourceSha}...master`]: { status: 'ahead', merge_base_commit: { sha: sourceSha } },
  });
  await checkSource(sourceSha, version, api(routes));
  await assert.rejects(assertLatestSource(sourceSha, api(routes)), /latest public master/);
  await assertLatestSource(sourceSha, api(sourceRoutes()));
});

test('live context excludes forks, branch workflows and disabled release mode', () => {
  const context = { GITHUB_REPOSITORY: controlRepository, GITHUB_REF: 'refs/heads/master',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GRAM_RELEASE_ENABLED: 'true' };
  assertLiveContext(context);
  for (const changes of [{ GITHUB_REPOSITORY: 'attacker/ton-wallet' }, { GITHUB_REF: 'refs/heads/test' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GRAM_RELEASE_ENABLED: '' }]) {
    assert.throws(() => assertLiveContext({ ...context, ...changes }));
  }
});

test('invalid source, version and rollout values fail before HTTP', () => {
  for (const args of [['master', version, 'stage', '5'], [sourceSha, '26.9.10;echo', 'check', '5'],
    [sourceSha, '26.9.65536', 'check', '5'], [sourceSha, version, 'publish', '5'],
    [sourceSha, version, 'stage', '0'], [sourceSha, version, 'stage', '5.5']]) {
    assert.throws(() => validateInputs(...args));
  }
  validateInputs(sourceSha, version, 'stage', '100');
});

test('receipt binds byte identity and independent source/pipeline/run identities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gram-provenance-'));
  try {
    const zip = join(directory, build.archiveName);
    const web = join(directory, build.webArchiveName);
    await writeFile(zip, 'valid zip fixture');
    await writeFile(web, 'valid web fixture');
    const receipt = await createBuildReceipt(zip, web, sourceSha, version, {
      GITHUB_REPOSITORY: controlRepository, GITHUB_SHA: controlSha, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
    });
    assert.deepEqual(receipt, build);
    await verifyBuildReceipt(receipt, directory);
    await writeFile(zip, 'tampered');
    await assert.rejects(verifyBuildReceipt(receipt, directory), /digest/);
    await writeFile(zip, 'valid zip fixture');
    for (const changes of [{ sourceRepository: 'attacker/wallet' }, { controlRepository: sourceRepository },
      { workflowRunAttempt: '2\n' }, { archiveName: '../escape.zip' }, { extensionId: 'fldfpgipfncgndfolcbkdeeknbbbnhcc' }]) {
      await assert.rejects(verifyBuildReceipt({ ...receipt, ...changes }, directory));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('selects exact successful run attempt and immutable artifact, not the latest same-version run', async () => {
  const routes = {
    [`${controlBase}/actions/runs/123/attempts/2`]: run(),
    [`${controlBase}/actions/runs/123/artifacts?per_page=100&page=1`]: { total_count: 2,
      artifacts: [artifact({ id: 700, name: 'gram-stage-123-1' }), artifact()] },
  };
  const selected = await selectArtifact('123', '2', 'stage', api(routes));
  assert.equal(selected.artifact.id, 789);
  for (const badRun of [{ conclusion: 'failure' }, { run_attempt: 3 }, { head_branch: 'feature' },
    { path: '.github/workflows/test.yml' }, { repository: { full_name: 'attacker/ton-wallet' } }]) {
    await assert.rejects(selectArtifact('123', '2', 'stage', api({ ...routes,
      [`${controlBase}/actions/runs/123/attempts/2`]: run(badRun) })));
  }
  for (const badArtifact of [{ expired: true }, { workflow_run: { id: 124, head_sha: controlSha } },
    { workflow_run: { id: 123, head_sha: sourceSha } }]) {
    await assert.rejects(selectArtifact('123', '2', 'stage', api({ ...routes,
      [`${controlBase}/actions/runs/123/artifacts?per_page=100&page=1`]: { total_count: 1, artifacts: [artifact(badArtifact)] } })));
  }
});

test('a successful operation artifact must bind its selected run, attempt and original build', () => {
  verifyOperationReceipt(stage, { run: run(), artifact: artifact(), kind: 'stage' });
  for (const changes of [{ success: false }, { operationRunId: '124' }, { operationRunAttempt: '1' },
    { operation: 'promote' }, { build: { ...build, controlSha: sourceSha } }]) {
    assert.throws(() => verifyOperationReceipt({ ...stage, ...changes }, { run: run(), artifact: artifact(), kind: 'stage' }));
  }
  const laterStage = { ...stage, operationRunAttempt: '3' };
  verifyOperationReceipt(laterStage, { run: run({ run_attempt: 3 }), artifact: artifact({ name: 'gram-stage-123-3' }), kind: 'stage' });
});

test('promotion receipt may come from a newer trusted pipeline but preserves original build SHA', () => {
  const operation = { ...stage, operation: 'promote', operationRunId: '234', operationRunAttempt: '1' };
  const selection = { kind: 'operation', run: run({ id: 234, run_attempt: 1,
    path: '.github/workflows/gram-chrome-publish.yml', head_sha: 'c'.repeat(40) }),
    artifact: artifact({ name: 'gram-operation-234-1', workflow_run: { id: 234, head_sha: 'c'.repeat(40) } }) };
  verifyOperationReceipt(operation, selection);
  assert.throws(() => verifyOperationReceipt({ ...operation, operation: 'stage' }, selection));
});


test('current run may reuse an earlier successful build attempt but not another source or pipeline', () => {
  const env = { GITHUB_REPOSITORY: controlRepository, GITHUB_SHA: controlSha, GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '3', RELEASE_SOURCE_SHA: sourceSha, RELEASE_VERSION: version };
  verifyCurrentBuild(build, env);
  for (const changes of [{ GITHUB_SHA: sourceSha }, { GITHUB_RUN_ID: '234' }, { GITHUB_RUN_ATTEMPT: '1' },
    { RELEASE_SOURCE_SHA: 'd'.repeat(40) }, { RELEASE_VERSION: '26.9.11' }]) {
    assert.throws(() => verifyCurrentBuild(build, { ...env, ...changes }));
  }
});

test('Pages artifact metadata binds the exact artifact ID to this pipeline run', () => {
  const pages = artifact({ name: 'github-pages-123-2' });
  verifyArtifactIdentity(pages, '789', '123', controlSha, 'github-pages-123-2');
  for (const change of [{ id: 788 }, { name: 'github-pages-123-1' }, { expired: true },
    { workflow_run: { id: 234, head_sha: controlSha } }, { workflow_run: { id: 123, head_sha: sourceSha } }]) {
    assert.throws(() => verifyArtifactIdentity({ ...pages, ...change }, '789', '123', controlSha, 'github-pages-123-2'));
  }
});


test('website verification rejects stale or unrelated public content', async () => {
  const marker = createWebMarker({ GITHUB_REPOSITORY: controlRepository, GITHUB_SHA: controlSha,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', RELEASE_SOURCE_SHA: sourceSha, RELEASE_VERSION: version });
  assert.equal(marker.sourceSha, sourceSha);
  const fetchImpl = async (url) => {
    assert.match(url, /^https:\/\/wallet\.ton\.org\/gram-release\.json\?/);
    return new Response(JSON.stringify(marker));
  };
  await verifyLiveWeb(build, { fetchImpl, attempts: 1 });
  await assert.rejects(verifyLiveWeb(build, { attempts: 1,
    fetchImpl: async () => new Response(JSON.stringify({ ...marker, sourceSha: 'f'.repeat(40) })) }), /Website/);
});

test('check succeeds with skipped publishers but stage never hides a skipped or failed job', () => {
  const checked = { source: { result: 'success' }, build: { result: 'success' }, validate: { result: 'success' },
    preflight: { result: 'skipped' }, web: { result: 'skipped' }, stage: { result: 'skipped' } };
  assertReleaseResult('check', checked);
  assert.throws(() => assertReleaseResult('stage', checked));
  assert.throws(() => assertReleaseResult('check', { ...checked, build: { result: 'failure' } }));
  assertReleaseResult('stage', { ...checked, preflight: { result: 'success' }, web: { result: 'success' }, stage: { result: 'success' } });
});
