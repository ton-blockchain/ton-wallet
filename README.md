# Gram Wallet releases

This repository builds and publishes [Gram Wallet Web](https://wallet.ton.org) and the [Gram Wallet Chrome extension](https://chromewebstore.google.com/detail/nphplpgoakhhjchkkhmiggakijnkhfnd). Application source lives in [mytonwallet-org/mytonwallet](https://github.com/mytonwallet-org/mytonwallet). Every build uses an exact public source commit and records it separately from the pipeline commit.

| Workflow | Purpose |
| --- | --- |
| `gram-release.yml` | Check a public release, or deploy its web build and submit its Chrome ZIP for staged review |
| `gram-chrome-publish.yml` | Activate an approved staged Chrome version or increase its rollout using an existing release receipt |
| `test.yml` | Test the receiver's release policy and scripts |

A normal My Wallet patch release triggers this pipeline from the public mirror. The upstream workflow only dispatches and observes this repository's run. Builds have no publishing credentials. A separate validation job checks the artifacts before a publisher receives them.

The Chrome item keeps ID `nphplpgoakhhjchkkhmiggakijnkhfnd`. Its existing users and storage remain attached to that item. Review approval does not automatically publish: the first submission uses staged publishing, followed by an explicit activation and controlled rollout. The website deploys through GitHub Pages Actions.

See [the release runbook](release.md) for setup, cutover, dispatch, recovery and rollback. Run receiver tests with `node --test tests/*.test.mjs` using Node 24; validate workflows with `actionlint`.

The old application source is preserved at commit [`ae5161e`](https://github.com/ton-blockchain/ton-wallet/tree/ae5161e75f232eb9364231bce9bdd87a2f3f2c4e), also prepared as the `archive/ton-wallet-4.0.7-source` tag. The checked-in `docs/` is the last legacy Pages site and remains a rollback snapshot during the transition. It is not a second application source tree.
