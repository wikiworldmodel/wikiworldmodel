#!/usr/bin/env bash
# Puts the latest world build (dist/builds) into the R2 bucket the public site reads its builds from,
# under the build's id, and checks that the store serves it. A build is put once and kept: its id is
# its content, so its files never change, and a link that names it keeps working after the next build
# is published. The Build workflow runs this before it publishes the site, whose index then points at
# the store; see site/README.md.
#
#   CLOUDFLARE_API_TOKEN   a token with Workers R2 Storage: Edit on the account
#   CLOUDFLARE_ACCOUNT_ID  the account the bucket is in
#   BUILD_BUCKET           the bucket
#   BUILD_STORE            the URL the bucket is served at, ending in a slash
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${BUILD_BUCKET:?}" "${BUILD_STORE:?}"

id=$(node -p "JSON.parse(require('fs').readFileSync('dist/builds/index.json', 'utf8')).latest")
dir="dist/builds/$id"
[ -f "$dir/tileset.json" ] || { echo "::error::$dir has no tileset.json: build the world first"; exit 1; }

# R2's S3 API takes a Cloudflare API token as its credentials: the token's id is the access key, and
# the SHA-256 of its value the secret. A token is a user's or the account's, and each is verified at
# its own address.
verify() { curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/$1/tokens/verify"; }
token_id=$({ verify user 2>/dev/null || verify "accounts/$CLOUDFLARE_ACCOUNT_ID"; } | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).result.id))')
secret=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.env.CLOUDFLARE_API_TOKEN).digest("hex"))')
if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$secret"; fi
export AWS_ACCESS_KEY_ID="$token_id" AWS_SECRET_ACCESS_KEY="$secret"
export AWS_DEFAULT_REGION=auto AWS_ENDPOINT_URL="https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws configure set default.s3.max_concurrent_requests 32

# The build's tileset.json goes in last, so a build that has one in the store is whole, and is not put
# again.
if aws s3api head-object --bucket "$BUILD_BUCKET" --key "$id/tileset.json" >/dev/null 2>&1; then
  echo "build $id is already in $BUILD_BUCKET"
else
  cache='public, max-age=31536000, immutable'
  aws s3 cp "$dir" "s3://$BUILD_BUCKET/$id" --recursive --exclude tileset.json --cache-control "$cache" --only-show-errors
  aws s3 cp "$dir/tileset.json" "s3://$BUILD_BUCKET/$id/tileset.json" --cache-control "$cache" --content-type application/json --only-show-errors
  echo "build $id put in $BUILD_BUCKET ($(find "$dir" -type f | wc -l) files)"
fi

# The site is published only if the store serves the build, to a page on another origin.
if ! curl -fsS -o /dev/null -H 'Origin: https://wikiworldmodel.org' -D - "${BUILD_STORE}${id}/tileset.json" | grep -qi '^access-control-allow-origin:'; then
  echo "::error::${BUILD_STORE}${id}/tileset.json is not served, or not to other origins: check the bucket's custom domain and CORS (site/README.md)"
  exit 1
fi
echo "served at ${BUILD_STORE}${id}/"
