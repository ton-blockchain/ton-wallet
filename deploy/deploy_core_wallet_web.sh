#!/usr/bin/env bash

set -e

git fetch upstream;
git reset --hard HEAD^;
git rebase upstream/master;
npm install;
npm run core:build:production;
rm -rf docs/;
mv dist/ docs/;
git add -A;
git commit -a -m '[Build]'
git push --force;
