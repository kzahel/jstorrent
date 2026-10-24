#!/usr/bin/env bash
set -euo pipefail

script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
client_root=$(cd "${script_root}/.." && pwd)

usage() {
  echo "usage: $0 ABSOLUTE_OUTPUT.xcresult" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
output=$1
[[ "${output}" = /* && "${output}" == *.xcresult ]] || usage
[[ ! -e "${output}" ]] || {
  echo "result bundle already exists: ${output}" >&2
  exit 2
}

source "${client_root}/../../scripts/dev-env.sh"
"${script_root}/generate-project.sh"

simulator_id=$(
  xcrun simctl list devices available -j |
    jq -r '
      [
        .devices
        | to_entries[]
        | select(.key | contains("iOS"))
        | .value[]
        | select(.isAvailable == true and (.name | startswith("iPhone")))
      ]
      | first
      | .udid // empty
    '
)
if [[ -z "${simulator_id}" ]]; then
  echo "no available iPhone simulator was found" >&2
  xcrun simctl list devices available >&2
  exit 1
fi

# Finish simulator boot and first-boot setup before Xcode starts its launch
# deadlines. -b also works when the selected simulator is already running.
xcrun simctl bootstatus "${simulator_id}" -b

xcodebuild \
  -project "${client_root}/RSTorrent.xcodeproj" \
  -scheme RSTorrent \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=${simulator_id}" \
  -parallel-testing-enabled NO \
  -resultBundlePath "${output}" \
  test \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO

test -d "${output}"
echo "Created ${output}"
