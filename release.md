# Release runbook

## Ownership and source

The app is released from `mytonwallet-org/mytonwallet-dev` into public `mytonwallet-org/mytonwallet/master`. This repository receives the exact public commit and expected version. A private SHA, an unmerged branch, a mismatched package or `.release` version, and a stale source at a live publishing boundary are rejected. GitHub Releases are not used as the source of truth because they can lag the public patch stream.

The application checkout only builds and tests. A fresh job checks out the receiver at its pipeline SHA, validates the uploaded web and Chrome outputs, and records their digests. Privileged jobs execute receiver scripts. They never run `npm install`, application scripts or executable content extracted from an artifact.

A release receipt binds source repository/SHA/version, receiver repository/SHA, workflow run/attempt, archive name/digest and the fixed Chrome item ID. Build success, Pages deployment, Store submission, staged approval, activation and rollout are separate observations. Only an explicit activation makes an approved staged version available to users.

## Provisioning

Keep both repositories' `GRAM_RELEASE_ENABLED` variable unset or `false` until the cutover below is complete.

| Location | Configuration |
| --- | --- |
| Public `mytonwallet` repository secret | `TON_WALLET_ACTIONS_TOKEN`: fine-grained token restricted to `ton-blockchain/ton-wallet`, Actions read/write; GitHub's required metadata access only |
| `ton-wallet` environment `production` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` from the publisher account with publish rights on the existing item |
| `ton-wallet` environment `production` variable | `GRAM_CHROME_PUBLISHER_ID`, copied from Chrome Web Store Publisher settings |
| `ton-wallet` environment `github-pages` | Permit deployment from `master`; preserve the configured custom domain |
| Both repositories | `GRAM_RELEASE_ENABLED=true` only after verified cutover |

For the dispatch token, repository Contents write is not required. A repository-scoped GitHub App installation token can replace the fine-grained token when a suitable installed App exists; configure token generation explicitly rather than assuming the caller's `GITHUB_TOKEN` can reach another repository. Receiver runs use their own token for artifacts and Pages.

Google credentials are environment secrets and must never be copied into a commit, command-line argument, dispatch payload or build artifact. Supply values through a secret manager or stdin. Record only secret names and successful API status in setup evidence.

Repository Maintain can update repository code and repository secrets. Configuring environment protection and environment secrets requires Admin; installing or expanding a GitHub App requires an eligible administrator or owner. Read back the actual persisted settings after provisioning. Read access to a public key does not prove that environment administration succeeded.

The receiver builds with production defaults from the pinned public application source. Copy the reviewed public `PROXY_HOSTS` and `WALLET_CONNECT_PROJECT_ID` repository variables from the existing public release configuration when provisioning. These are public build settings, not OAuth secrets. Add only reviewed public build configuration to its workflow; do not copy `.env`, beta job environments or arbitrary repository variables. Validate the resulting artifacts after any configuration change.

## Initial cutover

1. Publish the archive tag `archive/ton-wallet-4.0.7-source` pointing at `ae5161e75f232eb9364231bce9bdd87a2f3f2c4e`. Preserve history and the live `docs/` tree. Its original tree hash is `1b9fda3e09f230e939b6f798c6f4e183c8ffce87`.
2. Land the reviewed receiver workflows and removal of legacy multi-platform publishing. Do not provision Google secrets while the obsolete generic publisher is still enabled. These changes must be ordinary source commits; never use a `[Build]` commit subject.
3. Land the upstream thin dispatcher through the normal private-to-public release flow. Verify the former automatic `docs/` writer is gone. The legacy manual writer is removed from the upstream repository as part of that change.
4. Run receiver mode `check` at the chosen public SHA/version. Verify source identity, tests, both package validations, build receipt and ZIP digest. A local test pass is not a hosted check pass.
5. Provision credentials and environments. Preflight the Chrome item without uploading. Resolve any pending edit/review or unknown same-version draft before proceeding.
6. Change Pages publishing source to GitHub Actions, preserving `wallet.ton.org` and the existing domain configuration. Confirm the persisted Pages API state. Keep `docs/` unchanged so the former site can be restored during cutover.
7. Enable the receiver, then the upstream dispatcher. Start an explicit `stage` run for the agreed release. Verify Pages deployment and the live site's version/source receipt; separately verify that Chrome Web Store accepted staged review for the correct item/version.
8. After review approval and the release checks, activate the staged version at the chosen initial percentage. Verify Store state. Increase rollout only after checking release health.

The website and extension Store are not an atomic release. A Store submission failure after Pages deployment leaves the new website live and the existing extension published. Report this state explicitly; do not rebuild and blindly re-upload the same extension version.

## Failure and retry

- Dispatch POST is not retried automatically when its outcome is unknown. Reconcile the receiver's run list before submitting again. An HTTP acceptance alone is not release success.
- Source advancement while an older run waits causes that older live mutation to fail closed. Build a new candidate, or make a deliberate recovery decision; never resolve a moving branch name instead of the recorded SHA.
- Downloaded artifacts must match the requested run, attempt, workflow, repository and digest. An expired/deleted artifact or mismatched receipt blocks publication.
- Before the first Store upload, the stage job atomically creates `gram-chrome-stage-v<VERSION>`, an annotated Git tag containing the build receipt and attempt. This permanent claim survives artifact expiration. Only the stage job has Contents write; no job force-updates or deletes the claim.
- Any existing claim blocks another upload of that version, including a retry after a lost response. A claim may remain even when the first upload never started. Reconcile the Store and workflow state explicitly, or prepare a higher patch version; never remove the claim as routine retry cleanup.
- An unknown upload, a same-version draft without a verified successful receipt, or contradictory Store status blocks automation. Chrome Web Store does not expose a ZIP content hash. Reconcile the upload in the Store; do not equate a version string with proven content identity.
- Do not manually replace the Store draft between CI staging and activation. Activation is allowed only for the staged version recorded by the selected successful CI run.
- A rejected review requires correcting the stated issue and reconciling Store state before another submission. The pipeline does not cancel reviews, discard drafts or unpublish items automatically.
- If a publisher succeeds but the receipt cannot be saved, use the Store's actual state to investigate. Missing evidence is not permission to upload again.

## Website rollback

During the initial transition, disable the upstream automatic release switch and wait for active publishers to finish. Restore Pages publishing source to `master:/docs` while retaining `wallet.ton.org`. Request/observe its Pages build and verify the live site. This restores the preserved legacy web snapshot; it does not change the extension.

After the transition, prepare a reviewed web-only recovery using the exact previously validated web artifact and receipt. The normal release workflow intentionally rejects an older source at a live boundary. Do not weaken that guard, rebuild a moving ref, or use a Chrome rollback as a website rollback. Chrome users require a higher-version corrective release if an activated extension has a regression.

## Local validation

Use Node 24, Bash, `jq`, `unzip`, `zip` and `actionlint`:

```sh
node --test tests/*.test.mjs
actionlint
```

Tests use controlled network transports and do not publish. Actual credentials, Pages activation, Store acceptance and rollout must be verified separately and recorded with the exact run/attempt, source SHA and version.

## Dispatch

Resolve the full public commit and version before running. These commands are examples; replace the quoted placeholders with the reviewed values.

```sh
gh workflow run gram-release.yml --repo ton-blockchain/ton-wallet --ref master \
  -f source_sha='<40-character public SHA>' -f version='<YY.M.PATCH>' \
  -f mode=check -f rollout_percentage=5
```

After the check and activation prerequisites, use `mode=stage` for web deployment and Chrome staged review. A normal enabled public patch push dispatches that mode automatically. A release with `[skip ci]` requires explicit dispatch; do not remove the marker's intended behavior from other platform workflows.

After Google approves the staged version, select its successful release run and exact attempt:

```sh
gh workflow run gram-chrome-publish.yml --repo ton-blockchain/ton-wallet --ref master \
  -f operation=promote -f run_id='<stage run ID>' -f run_attempt='<attempt>'
```

Promotion preserves the percentage recorded at staging. To increase rollout, select the successful preceding promotion or rollout run, not the original stage run:

```sh
gh workflow run gram-chrome-publish.yml --repo ton-blockchain/ton-wallet --ref master \
  -f operation=rollout -f run_id='<promotion or rollout run ID>' \
  -f run_attempt='<attempt>' -f rollout_percentage=25
```

Store receipts are named `gram-stage-<run>-<attempt>` and `gram-operation-<run>-<attempt>`. Their `store-receipt.json` must link to the original validated build and ZIP digest. Use a successful original attempt; choosing a later rerun does not silently replace its artifacts.

Every live operation, including promotion and rollout, requires that the receipt source is still public master. A newer public release therefore blocks activation or expansion of an older version. Resolve the release order before dispatching; the pipeline will not make that decision by silently promoting stale code.

## References

- [GitHub workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub concurrency queues](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/)
- [Chrome Web Store publish modes](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish)
- [Chrome rollout increases](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/setPublishedDeployPercentage)
