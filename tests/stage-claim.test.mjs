import assert from 'node:assert/strict';
import test from 'node:test';
import { claimStage } from '../scripts/claim-stage.mjs';

const sourceSha = 'a'.repeat(40);
const controlSha = 'b'.repeat(40);
const tagSha = 'c'.repeat(40);
const build = { schemaVersion: 1, sourceRepository: 'mytonwallet-org/mytonwallet', sourceSha, version: '26.9.10',
  controlRepository: 'ton-blockchain/ton-wallet', controlSha, workflowRunId: '123', workflowRunAttempt: '1',
  archiveName: 'GramWallet-chrome-26.9.10.zip', archiveSha256: 'd'.repeat(64),
  webArchiveName: 'GramWallet-web-26.9.10.tar', webArchiveSha256: 'e'.repeat(64),
  extensionId: 'nphplpgoakhhjchkkhmiggakijnkhfnd' };
const env = { GITHUB_REPOSITORY: 'ton-blockchain/ton-wallet', GITHUB_REF: 'refs/heads/master',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GRAM_RELEASE_ENABLED: 'true', GITHUB_SHA: controlSha,
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', RELEASE_SOURCE_SHA: sourceSha, RELEASE_VERSION: '26.9.10' };
const ref = 'refs/tags/gram-chrome-stage-v26.9.10';
const base = '/repos/ton-blockchain/ton-wallet/git';

function server({ loseResponse = false, occupied = false } = {}) {
  let stored = occupied;
  const requests = [];
  return { requests, api: async (path, options = {}) => {
    requests.push({ path, ...options });
    if (path === `${base}/tags` && options.method === 'POST') {
      assert.equal(options.body.object, controlSha);
      assert.equal(options.body.type, 'commit');
      assert.equal(options.body.tag, 'gram-chrome-stage-v26.9.10');
      const message = JSON.parse(options.body.message);
      assert.deepEqual(message.build, build);
      assert.equal(message.operationRunId, '123');
      assert.equal(message.operationRunAttempt, '2');
      return { sha: tagSha };
    }
    if (path === `${base}/refs` && options.method === 'POST') {
      assert.deepEqual(options.body, { ref, sha: tagSha });
      if (stored) throw new Error('422 Reference already exists');
      stored = true;
      if (loseResponse) throw new Error('Connection lost after server accepted claim');
      return { ref, object: { sha: tagSha, type: 'tag' } };
    }
    if (path === `${base}/ref/tags/gram-chrome-stage-v26.9.10` && !options.method && stored) {
      return { ref, object: { sha: tagSha, type: 'tag' } };
    }
    throw new Error(`Unexpected fixture HTTP ${path}`);
  } };
}

test('stage claims a version once with complete build and attempt provenance', async () => {
  const state = server();
  await claimStage(build, { env, api: state.api });
  await assert.rejects(claimStage(build, { env, api: state.api }), /reconciliation/);
  assert.equal(state.requests.filter(({ path }) => path === `${base}/refs`).length, 2);
  assert.equal(state.requests.filter(({ method }) => method && method !== 'POST').length, 0);
});

test('atomic collision fails before any Store request and never overwrites a claim', async () => {
  const state = server({ occupied: true });
  await assert.rejects(claimStage(build, { env, api: state.api }), /reconciliation/);
  assert.equal(state.requests.length, 2);
});

test('lost claim response is not retried and a later attempt stays blocked', async () => {
  const state = server({ loseResponse: true });
  await assert.rejects(claimStage(build, { env, api: state.api }), /reconciliation/);
  assert.equal(state.requests.length, 2);
  await assert.rejects(claimStage(build, { env, api: state.api }), /reconciliation/);
  assert.equal(state.requests.length, 4);
});

test('mismatched source, version, pipeline and run cannot create a version claim', async () => {
  const state = server();
  for (const changes of [{ sourceSha: 'f'.repeat(40) }, { version: '26.9.11' }, { controlSha: sourceSha },
    { workflowRunId: '234' }, { workflowRunAttempt: '3' }]) {
    await assert.rejects(claimStage({ ...build, ...changes }, { env, api: state.api }));
  }
  assert.equal(state.requests.length, 0);
});

test('claim readback must confirm the exact tag object before proceeding', async () => {
  const state = server();
  await assert.rejects(claimStage(build, { env, api: async (path, options) => {
    const value = await state.api(path, options);
    if (path.includes('/ref/')) return { ...value, object: { sha: 'f'.repeat(40), type: 'tag' } };
    return value;
  } }), /reconciliation/);
});
