import { pathToFileURL } from 'node:url';

export const SOURCE_REPOSITORY = 'mytonwallet-org/mytonwallet';
export const CONTROL_REPOSITORY = 'ton-blockchain/ton-wallet';
export const EXTENSION_ID = 'nphplpgoakhhjchkkhmiggakijnkhfnd';
export const SHA = /^[0-9a-f]{40}$/;
export const INTEGER = /^[1-9][0-9]*$/;

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateVersion(version) {
  requireValue(typeof version === 'string' && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)
    && version.split('.').every((part) => Number(part) <= 65535), 'Invalid release version');
}

export function validateInputs(sourceSha, version, mode, rollout) {
  requireValue(SHA.test(sourceSha), 'A full source SHA is required');
  validateVersion(version);
  requireValue(['check', 'stage'].includes(mode), 'Mode must be check or stage');
  requireValue(typeof rollout === 'string' && INTEGER.test(rollout) && Number(rollout) <= 100, 'Invalid rollout percentage');
}

export function assertLiveContext(env = process.env) {
  requireValue(env.GITHUB_REPOSITORY === CONTROL_REPOSITORY
    && env.GITHUB_REF === 'refs/heads/master' && env.GITHUB_EVENT_NAME === 'workflow_dispatch',
  'Live operations require the control repository master workflow');
  requireValue(env.GRAM_RELEASE_ENABLED === 'true', 'Gram release publishing is disabled');
}

export function githubClient(token = process.env.GH_TOKEN, fetchImpl = globalThis.fetch) {
  return async (path, { method = 'GET', body } = {}) => {
    requireValue(path.startsWith('/repos/'), 'Invalid GitHub API path');
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    requireValue(response.ok, `GitHub API request failed: ${response.status}`);
    return response.json();
  };
}

async function readSourceFile(path, sourceSha, api) {
  const file = await api(`/repos/${SOURCE_REPOSITORY}/contents/${path}?ref=${sourceSha}`);
  requireValue(file.type === 'file' && file.encoding === 'base64', `Missing source file: ${path}`);
  return Buffer.from(file.content, 'base64').toString('utf8');
}

export async function checkSource(sourceSha, version, api = githubClient()) {
  validateInputs(sourceSha, version, 'check', '5');
  const repository = await api(`/repos/${SOURCE_REPOSITORY}`);
  requireValue(repository.full_name === SOURCE_REPOSITORY && repository.private === false
    && repository.default_branch === 'master', 'Source must be the fixed public repository');
  const comparison = await api(`/repos/${SOURCE_REPOSITORY}/compare/${sourceSha}...master`);
  requireValue(['ahead', 'identical'].includes(comparison.status)
    && comparison.merge_base_commit?.sha === sourceSha, 'Source is not on public master');
  const packageJson = JSON.parse(await readSourceFile('package.json', sourceSha, api));
  const releaseVersion = (await readSourceFile('.release', sourceSha, api)).split(/\r?\n/, 1)[0];
  requireValue(packageJson.version === version && releaseVersion === version, 'Source release version mismatch');
  return { sourceSha, version };
}

export async function assertLatestSource(sourceSha, api = githubClient()) {
  requireValue(SHA.test(sourceSha), 'A full source SHA is required');
  const master = await api(`/repos/${SOURCE_REPOSITORY}/commits/master`);
  requireValue(master.sha === sourceSha, 'Source is no longer the latest public master');
}

async function main() {
  const [command, sourceSha, version, mode = 'check', rollout = '5'] = process.argv.slice(2);
  if (command === 'check') {
    validateInputs(sourceSha, version, mode, rollout);
    if (mode === 'stage') assertLiveContext();
    await checkSource(sourceSha, version);
    if (mode === 'stage') await assertLatestSource(sourceSha);
  } else if (command === 'live') {
    assertLiveContext();
    await checkSource(sourceSha, version);
    await assertLatestSource(sourceSha);
  } else {
    throw new Error('Usage: source.mjs check SHA VERSION MODE ROLLOUT | live SHA VERSION');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
