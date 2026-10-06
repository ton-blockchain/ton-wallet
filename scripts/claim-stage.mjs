import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assertLiveContext, CONTROL_REPOSITORY, githubClient, requireValue, SHA } from './source.mjs';
import { verifyCurrentBuild } from './receipts.mjs';

export async function claimStage(build, { env = process.env, api = githubClient() } = {}) {
  assertLiveContext(env);
  verifyCurrentBuild(build, env);
  const tag = `gram-chrome-stage-v${build.version}`;
  const ref = `refs/tags/${tag}`;
  const base = `/repos/${CONTROL_REPOSITORY}/git`;
  const message = { schemaVersion: 1, operation: 'stage-intent', build,
    operationRunId: env.GITHUB_RUN_ID, operationRunAttempt: env.GITHUB_RUN_ATTEMPT };
  try {
    const object = await api(`${base}/tags`, { method: 'POST', body: {
      tag, message: JSON.stringify(message), object: env.GITHUB_SHA, type: 'commit',
    } });
    requireValue(SHA.test(object.sha), 'Invalid annotated tag response');
    await api(`${base}/refs`, { method: 'POST', body: { ref, sha: object.sha } });
    const saved = await api(`${base}/ref/tags/${tag}`);
    requireValue(saved.ref === ref && saved.object?.type === 'tag' && saved.object.sha === object.sha,
      'Stage claim readback mismatch');
  } catch (error) {
    throw new Error(`Version claim was not confirmed. Manual reconciliation is required for ${ref}; do not retry the Store upload. ${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  Promise.resolve().then(async () => {
    requireValue(path && process.env.GH_TOKEN, 'Usage: claim-stage.mjs BUILD_RECEIPT with GH_TOKEN');
    await claimStage(JSON.parse(await readFile(path, 'utf8')));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
