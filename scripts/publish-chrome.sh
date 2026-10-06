#!/usr/bin/env bash
set -euo pipefail
set +x

EXPECTED_EXTENSION_ID="nphplpgoakhhjchkkhmiggakijnkhfnd"
REQUIRED_OAUTH_SCOPE="https://www.googleapis.com/auth/chromewebstore"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-}"
OUTPUT_PATH=""
INPUT_RECEIPT=""
BUILD_RECEIPT=""
PHASE="validated"
STATE=""

fail() { echo "ERROR: $*" >&2; exit 1; }
usage() { fail "Usage: $0 preflight <version> <rollout> | stage <zip> <build-receipt> <rollout> <output-receipt> | promote <stage-receipt> <output-receipt> | rollout <promotion-receipt> <percentage> <output-receipt>"; }

case "$MODE" in
  preflight)
    [ "$#" -eq 3 ] || usage
    PACKAGE_VERSION="$2"; ROLLOUT_PERCENTAGE="$3"
    ;;
  stage)
    [ "$#" -eq 5 ] || usage
    ARCHIVE_PATH="$2"; BUILD_RECEIPT="$3"; ROLLOUT_PERCENTAGE="$4"; OUTPUT_PATH="$5"
    ;;
  promote)
    [ "$#" -eq 3 ] || usage
    INPUT_RECEIPT="$2"; OUTPUT_PATH="$3"
    ;;
  rollout)
    [ "$#" -eq 4 ] || usage
    INPUT_RECEIPT="$2"; ROLLOUT_PERCENTAGE="$3"; OUTPUT_PATH="$4"
    ;;
  *) usage ;;
esac
if [ -n "$OUTPUT_PATH" ] && [ -e "$OUTPUT_PATH" ]; then
  fail "Operation receipt already exists; inspect it before retrying and preserve the evidence."
fi

for executable in curl jq node; do
  command -v "$executable" >/dev/null || fail "$executable is required."
done
[ "${EXTENSION_ID:-}" = "$EXPECTED_EXTENSION_ID" ] || fail "EXTENSION_ID must be $EXPECTED_EXTENSION_ID."
[[ "${PUBLISHER_ID:-}" =~ ^[A-Za-z0-9_-]+$ ]] || fail "PUBLISHER_ID is required and must contain only letters, digits, underscores or hyphens."

validate_version() {
  local version="$1" part
  local parts=()
  [[ "$version" =~ ^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,3}$ ]] || fail "Invalid Chrome version: $version"
  IFS=. read -ra parts <<< "$version"
  for part in "${parts[@]}"; do
    [ "${#part}" -le 5 ] && [ "$part" -le 65535 ] || fail "Invalid Chrome version: $version"
  done
  [[ "$version" =~ [1-9] ]] || fail "Invalid all-zero Chrome version."
}

version_is_newer() {
  local candidate="$1" existing="$2" index left right
  local candidate_parts=() existing_parts=()
  validate_version "$candidate"; validate_version "$existing"
  IFS=. read -ra candidate_parts <<< "$candidate"
  IFS=. read -ra existing_parts <<< "$existing"
  for ((index = 0; index < 4; index++)); do
    left="${candidate_parts[$index]:-0}"; right="${existing_parts[$index]:-0}"
    ((left > right)) && return 0
    ((left < right)) && return 1
  done
  return 1
}

validate_build_receipt() {
  jq -e --arg item "$EXPECTED_EXTENSION_ID" '
    def fullsha: type == "string" and test("^[a-f0-9]{40}$");
    def runid: type == "string" and test("^[1-9][0-9]*$");
    type == "object" and .schemaVersion == 1
    and .sourceRepository == "mytonwallet-org/mytonwallet" and (.sourceSha | fullsha)
    and .controlRepository == "ton-blockchain/ton-wallet" and (.controlSha | fullsha)
    and (.workflowRunId | runid) and (.workflowRunAttempt | runid)
    and (.archiveName | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]*\\.zip$"))
    and (.archiveSha256 | type == "string" and test("^[a-f0-9]{64}$"))
    and (.version | type == "string") and .extensionId == $item
  ' "$BUILD_RECEIPT" >/dev/null || fail "Invalid build receipt."
  PACKAGE_VERSION="$(jq -r '.version' "$BUILD_RECEIPT")"
  SOURCE_SHA="$(jq -r '.sourceSha' "$BUILD_RECEIPT")"
  validate_version "$PACKAGE_VERSION"
}

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
if [ -n "$INPUT_RECEIPT" ]; then
  [ "$OUTPUT_PATH" != "$INPUT_RECEIPT" ] || fail "Input and output receipts must differ."
  jq -e --arg publisher "$PUBLISHER_ID" --arg mode "$MODE" '
    def runid: type == "string" and test("^[1-9][0-9]*$");
    type == "object" and .schemaVersion == 1 and .success == true
    and .publisherId == $publisher and (.operationRunId | runid) and (.operationRunAttempt | runid)
    and (.rolloutPercentage | type == "number" and floor == . and . >= 1 and . <= 100)
    and (if $mode == "promote" then
      .operation == "stage" and (.state == "PENDING_REVIEW" or .state == "STAGED")
    else (.operation == "promote" or .operation == "rollout") and .state == "PUBLISHED" end)
  ' "$INPUT_RECEIPT" >/dev/null || fail "A successful matching Store receipt is required."
  BUILD_RECEIPT="$TEMP_DIR/build.json"
  jq '.build' "$INPUT_RECEIPT" > "$BUILD_RECEIPT"
  PREVIOUS_PERCENTAGE="$(jq -r '.rolloutPercentage' "$INPUT_RECEIPT")"
  if [ "$MODE" = "promote" ]; then ROLLOUT_PERCENTAGE="$PREVIOUS_PERCENTAGE"; fi
fi
if [ -n "$BUILD_RECEIPT" ]; then validate_build_receipt; fi
validate_version "$PACKAGE_VERSION"
[[ "$ROLLOUT_PERCENTAGE" =~ ^([1-9]|[1-9][0-9]|100)$ ]] || fail "Rollout must be an integer from 1 through 100."
if [ "$MODE" = "rollout" ]; then
  [ "$ROLLOUT_PERCENTAGE" -gt "$PREVIOUS_PERCENTAGE" ] || fail "Rollout must strictly increase the recorded percentage."
fi

write_receipt() {
  local success="$1"
  [ -n "$OUTPUT_PATH" ] || return 0
  jq -n --slurpfile build "$BUILD_RECEIPT" --arg operation "$MODE" --argjson success "$success" \
    --arg publisher "$PUBLISHER_ID" --argjson rollout "$ROLLOUT_PERCENTAGE" --arg state "$STATE" \
    --arg phase "$PHASE" --arg run "$GITHUB_RUN_ID" --arg attempt "$GITHUB_RUN_ATTEMPT" '
    {schemaVersion:1, operation:$operation, success:$success, build:$build[0], publisherId:$publisher,
      rolloutPercentage:$rollout, state:$state, operationRunId:$run, operationRunAttempt:$attempt}
    + if $success then {} else {phase:$phase} end
  ' > "$OUTPUT_PATH.tmp"
  mv "$OUTPUT_PATH.tmp" "$OUTPUT_PATH"
}

if [ -n "$OUTPUT_PATH" ]; then
  [[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] && [[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]] \
    || fail "A GitHub run ID and attempt are required for Store receipts."
  [ "$OUTPUT_PATH" != "$BUILD_RECEIPT" ] || fail "Output must not overwrite the build receipt."
  write_receipt false
fi
if [ "$MODE" = "stage" ]; then
  [ "$(basename "$ARCHIVE_PATH")" = "$(jq -r '.archiveName' "$BUILD_RECEIPT")" ] || fail "ZIP name differs from its receipt."
  node "$SCRIPT_DIR/validate-chrome.mjs" "$ARCHIVE_PATH" "$PACKAGE_VERSION" "$(jq -r '.archiveSha256' "$BUILD_RECEIPT")"
fi
for secret_name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN; do
  [ -n "${!secret_name:-}" ] || fail "$secret_name is required."
done

TOKEN_RESPONSE="$TEMP_DIR/token.json"
STATUS_RESPONSE="$TEMP_DIR/status.json"
ITEM_URL="https://chromewebstore.googleapis.com/v2/publishers/$PUBLISHER_ID/items/$EXPECTED_EXTENSION_ID"
curl --fail-with-body --silent --show-error --output "$TOKEN_RESPONSE" \
  --data-urlencode "client_id=$GOOGLE_CLIENT_ID" --data-urlencode "client_secret=$GOOGLE_CLIENT_SECRET" \
  --data-urlencode "refresh_token=$GOOGLE_REFRESH_TOKEN" --data-urlencode "grant_type=refresh_token" \
  https://oauth2.googleapis.com/token
ACCESS_TOKEN="$(jq -er '.access_token | select(type == "string" and length > 0)' "$TOKEN_RESPONSE")" \
  || fail "OAuth response did not contain an access token."
jq -e --arg scope "$REQUIRED_OAUTH_SCOPE" \
  '.scope | select(type == "string") | split(" ") | index($scope) != null' "$TOKEN_RESPONSE" >/dev/null \
  || fail "OAuth response must report the full chromewebstore scope."

fetch_status() {
  curl --fail-with-body --silent --show-error --output "$STATUS_RESPONSE" \
    --header "Authorization: Bearer $ACCESS_TOKEN" "$ITEM_URL:fetchStatus"
  [ "$(jq -r '.itemId // empty' "$STATUS_RESPONSE")" = "$EXPECTED_EXTENSION_ID" ] || fail "Store returned the wrong item."
}

validate_health() {
  [ "$(jq -r '.takenDown // false' "$STATUS_RESPONSE")" = "false" ] || fail "Store item is taken down."
  if [ "$ROLLOUT_PERCENTAGE" -lt 100 ] && [ "$(jq -r '.warned // false' "$STATUS_RESPONSE")" = "true" ]; then
    fail "Store item is warned; the next rollout must be 100%."
  fi
}

published_has_candidate() {
  jq -e --arg version "$PACKAGE_VERSION" \
    '[.publishedItemRevisionStatus.distributionChannels[]? | select(.crxVersion == $version)] | length > 0' \
    "$STATUS_RESPONSE" >/dev/null
}

matches_channel() {
  jq -e --arg revision "$1" --arg version "$PACKAGE_VERSION" --argjson percentage "$2" '
    .[$revision].distributionChannels
    | if type == "array" then
      map(select(type == "object") | select(.crxVersion == $version))
      | length == 1 and .[0].deployPercentage == $percentage
    else false end
  ' "$STATUS_RESPONSE" >/dev/null
}

validate_new_version() {
  local version state submitted_versions
  state="$(jq -r '.submittedItemRevisionStatus.state // empty' "$STATUS_RESPONSE")"
  submitted_versions="$(jq -r '[.submittedItemRevisionStatus.distributionChannels[]?.crxVersion] | join(", ")' "$STATUS_RESPONSE")"
  case "$state" in
    ""|CANCELLED|REJECTED) ;;
    *) fail "Store revision ${submitted_versions:-unknown} is $state; new staging is blocked and web deployment remains blocked. Resolve the existing review first; never cancel or replace it automatically." ;;
  esac
  while IFS= read -r version; do
    version_is_newer "$PACKAGE_VERSION" "$version" || fail "Candidate must be newer than Store version $version."
  done < <(jq -r '[.publishedItemRevisionStatus.distributionChannels[]?.crxVersion,
    .submittedItemRevisionStatus.distributionChannels[]?.crxVersion] | .[] | select(type == "string")' "$STATUS_RESPONSE")
}

validate_recorded_version() {
  local version state
  while IFS= read -r version; do
    [ "$version" = "$PACKAGE_VERSION" ] || version_is_newer "$PACKAGE_VERSION" "$version" \
      || fail "Store already has a newer version $version."
  done < <(jq -r '[.publishedItemRevisionStatus.distributionChannels[]?.crxVersion,
    .submittedItemRevisionStatus.distributionChannels[]?.crxVersion] | .[] | select(type == "string")' "$STATUS_RESPONSE")
  state="$(jq -r '.submittedItemRevisionStatus.state // empty' "$STATUS_RESPONSE")"
  case "$state" in
    ""|CANCELLED|REJECTED) return ;;
  esac
  jq -e --arg version "$PACKAGE_VERSION" '.submittedItemRevisionStatus.distributionChannels
    | type == "array" and length > 0 and all(.[]; .crxVersion == $version)' "$STATUS_RESPONSE" >/dev/null \
    || fail "Store has a conflicting submitted revision."
  if [ "$MODE" = "rollout" ] && [ "$state" != "PUBLISHED" ]; then
    fail "Store has a submitted revision in state $state; reconcile it before increasing rollout."
  fi
}

request_publish() {
  local publish_type="$1"
  local response="$TEMP_DIR/publish.json" body
  if [ "$MODE" = "stage" ]; then
    node "$SCRIPT_DIR/source.mjs" live "$SOURCE_SHA" "$PACKAGE_VERSION"
  else
    node "$SCRIPT_DIR/source.mjs" recorded "$SOURCE_SHA" "$PACKAGE_VERSION"
  fi
  body="$(jq -nc --arg type "$publish_type" --argjson rollout "$ROLLOUT_PERCENTAGE" \
    '{publishType:$type, deployInfos:[{deployPercentage:$rollout}], skipReview:false, blockOnWarnings:true}')"
  PHASE="publish-requested"; write_receipt false
  curl --fail-with-body --silent --show-error --request POST --output "$response" \
    --header "Authorization: Bearer $ACCESS_TOKEN" --header "Content-Type: application/json" \
    --data "$body" "$ITEM_URL:publish"
  [ "$(jq -r '.itemId // empty' "$response")" = "$EXPECTED_EXTENSION_ID" ] || fail "Publish returned the wrong item."
  STATE="$(jq -r '.state // empty' "$response")"
  if [ "$MODE" = "stage" ]; then
    case "$STATE" in PENDING_REVIEW|STAGED) ;; *) fail "Staged publish returned unexpected state $STATE." ;; esac
  else
    [ "$STATE" = "PUBLISHED" ] || fail "Activation returned unexpected state $STATE."
  fi
  PHASE="publish-accepted"; write_receipt false
}

fetch_status
validate_health
case "$MODE" in
  preflight|stage) validate_new_version ;;
  promote)
    published_has_candidate && fail "Candidate is already published; reconcile the previous operation before retrying."
    [ "$(jq -r '.submittedItemRevisionStatus.state // empty' "$STATUS_RESPONSE")" = "STAGED" ] \
      || fail "Candidate must be STAGED before activation."
    matches_channel submittedItemRevisionStatus "$ROLLOUT_PERCENTAGE" || fail "Staged version or rollout differs from receipt."
    validate_recorded_version
    ;;
  rollout)
    [ "$(jq -r '.publishedItemRevisionStatus.state // empty' "$STATUS_RESPONSE")" = "PUBLISHED" ] \
      || fail "Candidate must be PUBLISHED before increasing rollout."
    matches_channel publishedItemRevisionStatus "$PREVIOUS_PERCENTAGE" || fail "Published version or rollout differs from receipt."
    validate_recorded_version
    ;;
esac
if [ "$MODE" = "preflight" ]; then
  echo "Store preflight OK: item=$EXPECTED_EXTENSION_ID candidate=$PACKAGE_VERSION rollout=$ROLLOUT_PERCENTAGE%."
  exit 0
fi

if [ "$MODE" = "stage" ]; then
  UPLOAD_RESPONSE="$TEMP_DIR/upload.json"
  node "$SCRIPT_DIR/source.mjs" live "$SOURCE_SHA" "$PACKAGE_VERSION"
  node "$SCRIPT_DIR/claim-stage.mjs" "$BUILD_RECEIPT"
  node "$SCRIPT_DIR/source.mjs" live "$SOURCE_SHA" "$PACKAGE_VERSION"
  PHASE="upload-requested"; write_receipt false
  curl --fail-with-body --silent --show-error --request POST --upload-file "$ARCHIVE_PATH" \
    --output "$UPLOAD_RESPONSE" --header "Authorization: Bearer $ACCESS_TOKEN" \
    "https://chromewebstore.googleapis.com/upload/v2/publishers/$PUBLISHER_ID/items/$EXPECTED_EXTENSION_ID:upload"
  [ "$(jq -r '.itemId // empty' "$UPLOAD_RESPONSE")" = "$EXPECTED_EXTENSION_ID" ] || fail "Upload returned the wrong item."
  UPLOAD_STATE="$(jq -r '.uploadState // empty' "$UPLOAD_RESPONSE")"
  UPLOADED_VERSION="$(jq -r '.crxVersion // empty' "$UPLOAD_RESPONSE")"
  if [ "$UPLOAD_STATE" = "IN_PROGRESS" ]; then
    for _ in {1..12}; do
      sleep 5; fetch_status
      UPLOAD_STATE="$(jq -r '.lastAsyncUploadState // empty' "$STATUS_RESPONSE")"
      [ "$UPLOAD_STATE" = "IN_PROGRESS" ] || break
    done
  else
    [ "$UPLOADED_VERSION" = "$PACKAGE_VERSION" ] || fail "Uploaded version differs from the selected ZIP."
  fi
  [ "$UPLOAD_STATE" = "SUCCEEDED" ] || fail "Upload state is $UPLOAD_STATE."
  [ -z "$UPLOADED_VERSION" ] || [ "$UPLOADED_VERSION" = "$PACKAGE_VERSION" ] || fail "Uploaded version differs from receipt."
  PHASE="upload-confirmed"; write_receipt false
  request_publish STAGED_PUBLISH
elif [ "$MODE" = "promote" ]; then
  request_publish DEFAULT_PUBLISH
else
  node "$SCRIPT_DIR/source.mjs" recorded "$SOURCE_SHA" "$PACKAGE_VERSION"
  PHASE="rollout-requested"; write_receipt false
  curl --fail-with-body --silent --show-error --request POST --output "$TEMP_DIR/rollout.json" \
    --header "Authorization: Bearer $ACCESS_TOKEN" --header "Content-Type: application/json" \
    --data "$(jq -nc --argjson percentage "$ROLLOUT_PERCENTAGE" '{deployPercentage:$percentage}')" \
    "$ITEM_URL:setPublishedDeployPercentage"
  PHASE="rollout-accepted"; write_receipt false
fi

READBACK_OK=0
for attempt in {1..12}; do
  fetch_status
  if [ "$MODE" = "stage" ]; then
    published_has_candidate && fail "Staged candidate unexpectedly appears in published channels."
    STATE="$(jq -r '.submittedItemRevisionStatus.state // empty' "$STATUS_RESPONSE")"
    if { [ "$STATE" = "PENDING_REVIEW" ] || [ "$STATE" = "STAGED" ]; } \
      && matches_channel submittedItemRevisionStatus "$ROLLOUT_PERCENTAGE"; then READBACK_OK=1; break; fi
  else
    STATE="$(jq -r '.publishedItemRevisionStatus.state // empty' "$STATUS_RESPONSE")"
    if [ "$STATE" = "PUBLISHED" ] && matches_channel publishedItemRevisionStatus "$ROLLOUT_PERCENTAGE"; then
      validate_recorded_version
      READBACK_OK=1; break
    fi
  fi
  [ "$attempt" = "12" ] || sleep 5
done
[ "$READBACK_OK" = "1" ] || fail "Store readback did not confirm $MODE of $PACKAGE_VERSION at $ROLLOUT_PERCENTAGE%."
PHASE="confirmed"; write_receipt true
if [ "$MODE" = "stage" ]; then
  echo "Submitted Gram Wallet $PACKAGE_VERSION: $STATE at $ROLLOUT_PERCENTAGE%; it is not published."
else
  echo "Confirmed Gram Wallet $PACKAGE_VERSION: PUBLISHED at $ROLLOUT_PERCENTAGE%."
fi
