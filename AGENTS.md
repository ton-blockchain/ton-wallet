# Repository guidance

This repository owns Gram Wallet release workflows, artifact policy and publishing. Application changes belong in `mytonwallet-org/mytonwallet-dev` and arrive through its public release mirror.

- Keep `sourceSha` (application) separate from `controlSha` (this repository).
- Build only the fixed public source repository at the requested immutable commit. Execute publishing logic from this repository's trusted workflow revision.
- Keep OAuth credentials out of application build and validation jobs, dispatch inputs, logs and artifacts.
- Preserve Chrome item ID `nphplpgoakhhjchkkhmiggakijnkhfnd`, legacy storage keys and the `wallet.ton.org` domain.
- An upload, review submission, review approval, publication and rollout increase are separate states. Check actual Store state and fail closed when a response is ambiguous.
- Serialize production mutations. Never cancel an active publisher or automatically replace an unknown same-version package.
- Preserve `docs/` as the legacy Pages rollback snapshot until its retirement is explicitly included in a reviewed deployment change.
- Run `node --test tests/*.test.mjs` and `actionlint` after workflow or script changes. Tests replace network transports; they must never publish to real services.

The operational contract is in [release.md](release.md). Keep it aligned with workflow inputs, artifacts and recovery behavior.
