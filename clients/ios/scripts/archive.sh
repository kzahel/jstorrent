#!/usr/bin/env bash
set -euo pipefail

script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
client_root=$(cd "${script_root}/.." && pwd)

usage() {
  echo "usage: $0 (--unsigned|--development) ABSOLUTE_OUTPUT.xcarchive" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
mode=$1
output=$2
[[ "${output}" = /* && "${output}" == *.xcarchive ]] || usage

source "${client_root}/../../scripts/dev-env.sh"
"${script_root}/generate-project.sh"

common=(
  -project "${client_root}/RSTorrent.xcodeproj"
  -scheme RSTorrent
  -configuration Release
  -destination "generic/platform=iOS"
  -archivePath "${output}"
  archive
)

case "${mode}" in
  --unsigned)
    xcodebuild "${common[@]}" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
    ;;
  --development)
    : "${RSTORRENT_IOS_DEVELOPMENT_TEAM:?set RSTORRENT_IOS_DEVELOPMENT_TEAM}"
    xcodebuild "${common[@]}" \
      DEVELOPMENT_TEAM="${RSTORRENT_IOS_DEVELOPMENT_TEAM}" \
      CODE_SIGN_STYLE=Automatic \
      -allowProvisioningUpdates
    ;;
  *)
    usage
    ;;
esac

test -d "${output}/Products/Applications/RSTorrent.app"
echo "Created ${output}"
