import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTROL_REPOSITORY, EXTENSION_ID, INTEGER, SHA, SOURCE_REPOSITORY, githubClient, requireValue,
  validateVersion } from './source.mjs';

const DIGEST = /^[0-9a-f]{64}$/;
const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

function validateBuild(receipt) {
  requireValue(receipt?.schemaVersion === 1 && receipt.sourceRepository === SOURCE_REPOSITORY
    && receipt.controlRepository === CONTROL_REPOSITORY && receipt.extensionId === EXTENSION_ID,
  'Invalid build receipt identity');
  validateVersion(receipt.version);
  requireValue(SHA.test(receipt.sourceSha) && SHA.test(receipt.controlSha), 'Invalid receipt commit');
  for (const value of [receipt.workflowRunId, receipt.workflowRunAttempt]) {
    requireValue(typeof value === 'string' && INTEGER.test(value), 'Invalid receipt run identity');
  }
  requireValue(receipt.archiveName === `GramWallet-chrome-${receipt.version}.zip`
    && receipt.webArchiveName === `GramWallet-web-${receipt.version}.tar`
    && DIGEST.test(receipt.archiveSha256) && DIGEST.test(receipt.webArchiveSha256), 'Invalid receipt archive identity');
}

export async function createBuildReceipt(zip, web, sourceSha, version, env = process.env) {
  const receipt = { schemaVersion: 1, sourceRepository: SOURCE_REPOSITORY, sourceSha, version,
    controlRepository: env.GITHUB_REPOSITORY, controlSha: env.GITHUB_SHA,
    workflowRunId: env.GITHUB_RUN_ID, workflowRunAttempt: env.GITHUB_RUN_ATTEMPT,
    archiveName: basename(zip), archiveSha256: await sha256(zip), extensionId: EXTENSION_ID,
    webArchiveName: basename(web), webArchiveSha256: await sha256(web) };
  validateBuild(receipt);
  return receipt;
}

export async function verifyBuildReceipt(receipt, directory) {
  validateBuild(receipt);
  requireValue(await sha256(join(directory, receipt.archiveName)) === receipt.archiveSha256,
    'Chrome archive digest mismatch');
  requireValue(await sha256(join(directory, receipt.webArchiveName)) === receipt.webArchiveSha256,
    'Web archive digest mismatch');
  return receipt;
}

function validateRun(run, runId, attempt, kind) {
  const path = kind === 'operation' ? '.github/workflows/gram-chrome-publish.yml' : '.github/workflows/gram-release.yml';
  requireValue(String(run.id) === runId && String(run.run_attempt) === attempt
    && run.repository?.full_name === CONTROL_REPOSITORY && run.head_repository?.full_name === CONTROL_REPOSITORY
    && run.path === path && run.event === 'workflow_dispatch' && run.head_branch === 'master'
    && SHA.test(run.head_sha), 'Unexpected workflow run identity');
  requireValue(run.status === 'completed' && (kind === 'build' || run.conclusion === 'success'),
    'The original workflow attempt must have succeeded');
}

export async function selectArtifact(runId, attempt, kind, api = githubClient()) {
  requireValue(typeof runId === 'string' && INTEGER.test(runId)
    && typeof attempt === 'string' && INTEGER.test(attempt) && ['stage', 'operation', 'build'].includes(kind),
  'Invalid artifact selection');
  const base = `/repos/${CONTROL_REPOSITORY}/actions/runs/${runId}`;
  const run = await api(`${base}/attempts/${attempt}`);
  validateRun(run, runId, attempt, kind);
  const matches = [];
  for (let page = 1; ; page++) {
    const listing = await api(`${base}/artifacts?per_page=100&page=${page}`);
    requireValue(Array.isArray(listing.artifacts), 'Invalid artifact response');
    matches.push(...listing.artifacts.filter((item) => item.name === `gram-${kind}-${runId}-${attempt}`));
    if (page * 100 >= listing.total_count) break;
    requireValue(page < 100, 'Artifact listing exceeds the supported limit');
  }
  requireValue(matches.length === 1, 'Expected exactly one original artifact');
  const artifact = matches[0];
  requireValue(artifact.expired === false && Number.isSafeInteger(artifact.id) && artifact.id > 0
    && String(artifact.workflow_run?.id) === runId && artifact.workflow_run?.head_sha === run.head_sha,
  'Artifact provenance mismatch or expired artifact');
  return { run, artifact, kind };
}

export function verifyOperationReceipt(receipt, selection) {
  const { run, artifact, kind } = selection;
  validateRun(run, String(run.id), String(run.run_attempt), kind);
  requireValue(artifact.name === `gram-${kind}-${run.id}-${run.run_attempt}`
    && String(artifact.workflow_run?.id) === String(run.id) && artifact.workflow_run?.head_sha === run.head_sha,
  'Selected artifact identity mismatch');
  requireValue(receipt?.schemaVersion === 1 && receipt.success === true
    && receipt.operationRunId === String(run.id) && receipt.operationRunAttempt === String(run.run_attempt),
  'Operation receipt does not match the successful workflow attempt');
  validateBuild(receipt.build);
  if (kind === 'stage') {
    requireValue(receipt.operation === 'stage' && receipt.build.workflowRunId === String(run.id)
      && Number(receipt.build.workflowRunAttempt) <= run.run_attempt && receipt.build.controlSha === run.head_sha,
    'Stage receipt does not match its original build');
  } else {
    requireValue(kind === 'operation' && ['promote', 'rollout'].includes(receipt.operation),
      'Expected a successful promotion or rollout receipt');
  }
  return receipt;
}

export function verifySelectedBuild(receipt, selection) {
  validateBuild(receipt);
  requireValue(selection.kind === 'build' && receipt.workflowRunId === String(selection.run.id)
    && receipt.workflowRunAttempt === String(selection.run.run_attempt)
    && receipt.controlSha === selection.run.head_sha, 'Build receipt does not match its selected run');
}

async function output(values) {
  requireValue(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required');
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create') {
    const [zip, web, sourceSha, version, destination] = args;
    await writeJson(destination, await createBuildReceipt(zip, web, sourceSha, version));
  } else if (command === 'verify-build') {
    const [path, directory, selectionPath] = args;
    const receipt = await verifyBuildReceipt(await readJson(path), directory);
    if (selectionPath === 'current') verifyCurrentBuild(receipt);
    else if (selectionPath) verifySelectedBuild(receipt, await readJson(selectionPath));
  } else if (command === 'select') {
    const [runId, attempt, kind, destination] = args;
    const selection = await selectArtifact(runId, attempt, kind);
    await writeJson(destination, selection);
    await output({ artifact_id: selection.artifact.id });
  } else if (command === 'marker') {
    await writeJson(args[0], createWebMarker());
  } else if (command === 'live-web') {
    await verifyLiveWeb(await readJson(args[0]));
  } else if (command === 'result') {
    assertReleaseResult(args[0], JSON.parse(process.env.JOB_RESULTS));
  } else if (command === 'artifact') {
    const [artifactId, name] = args;
    requireValue(INTEGER.test(artifactId), 'Invalid artifact ID');
    const artifact = await githubClient()(`/repos/${CONTROL_REPOSITORY}/actions/artifacts/${artifactId}`);
    verifyArtifactIdentity(artifact, artifactId, process.env.GITHUB_RUN_ID, process.env.GITHUB_SHA, name);
  } else if (command === 'operation') {
    const [receiptPath, selectionPath, buildPath] = args;
    const receipt = verifyOperationReceipt(await readJson(receiptPath), await readJson(selectionPath));
    if (buildPath) {
      const original = await readJson(buildPath);
      requireValue(JSON.stringify(receipt.build) === JSON.stringify(original), 'Operation uses a different build receipt');
    }
    await output({ source_sha: receipt.build.sourceSha, version: receipt.build.version,
      build_run_id: receipt.build.workflowRunId, build_run_attempt: receipt.build.workflowRunAttempt,
      archive_name: receipt.build.archiveName, archive_sha256: receipt.build.archiveSha256 });
  } else {
    throw new Error('Usage: receipts.mjs create|verify-build|select|operation ...');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

export function verifyCurrentBuild(receipt, env = process.env) {
  validateBuild(receipt);
  requireValue(receipt.controlRepository === env.GITHUB_REPOSITORY && receipt.controlSha === env.GITHUB_SHA
    && receipt.workflowRunId === env.GITHUB_RUN_ID && INTEGER.test(env.GITHUB_RUN_ATTEMPT)
    && Number(receipt.workflowRunAttempt) <= Number(env.GITHUB_RUN_ATTEMPT)
    && receipt.sourceSha === env.RELEASE_SOURCE_SHA && receipt.version === env.RELEASE_VERSION,
  'Build receipt is not from this release run');
}
export function verifyArtifactIdentity(artifact, artifactId, runId, controlSha, name) {
  requireValue(String(artifact.id) === artifactId && artifact.name === name && artifact.expired === false
    && String(artifact.workflow_run?.id) === runId && artifact.workflow_run?.head_sha === controlSha,
  'Artifact metadata does not match this release run');
}

export function createWebMarker(env = process.env) {
  validateVersion(env.RELEASE_VERSION);
  requireValue(env.GITHUB_REPOSITORY === CONTROL_REPOSITORY && SHA.test(env.GITHUB_SHA)
    && SHA.test(env.RELEASE_SOURCE_SHA) && INTEGER.test(env.GITHUB_RUN_ID)
    && INTEGER.test(env.GITHUB_RUN_ATTEMPT), 'Invalid web release identity');
  return { schemaVersion: 1, sourceRepository: SOURCE_REPOSITORY, sourceSha: env.RELEASE_SOURCE_SHA,
    version: env.RELEASE_VERSION, controlRepository: CONTROL_REPOSITORY, controlSha: env.GITHUB_SHA,
    workflowRunId: env.GITHUB_RUN_ID, workflowRunAttempt: env.GITHUB_RUN_ATTEMPT };
}
export async function verifyLiveWeb(receipt, { fetchImpl = globalThis.fetch, attempts = 30 } = {}) {
  validateBuild(receipt);
  const keys = ['schemaVersion', 'sourceRepository', 'sourceSha', 'version', 'controlRepository', 'controlSha',
    'workflowRunId', 'workflowRunAttempt'];
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(`https://wallet.ton.org/gram-release.json?run=${receipt.workflowRunId}-${receipt.workflowRunAttempt}`, {
        headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const marker = await response.json();
        if (keys.every((key) => marker[key] === receipt[key])) return;
      }
    } catch { /* Retry public propagation and transient HTTP failures. */ }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
  throw new Error('Website does not serve the expected release identity');
}
export function assertReleaseResult(mode, results) {
  const jobs = { check: ['source', 'build', 'validate'], preflight: ['source', 'preflight'],
    stage: ['source', 'build', 'validate', 'preflight', 'web', 'stage'] };
  requireValue(Object.hasOwn(jobs, mode), 'Invalid release mode');
  const required = jobs[mode];
  for (const job of required) requireValue(results[job]?.result === 'success', `Required release job did not succeed: ${job}`);
  for (const job of jobs.stage.filter((name) => !required.includes(name))) {
    requireValue(results[job]?.result === 'skipped', `Unexpected release job execution: ${job}`);
  }
}
