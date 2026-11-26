#!/usr/bin/env bash
set -euo pipefail

bundle_id=com.jstorrent.ios

if [[ $# -lt 3 || $# -gt 4 || ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ! "$2" =~ ^[1-9][0-9]*$ || "$3" != /* || -e "$3" ]]; then
  echo "usage: $0 VERSION BUILD ABSOLUTE_NEW_OUTPUT_DIRECTORY [REPOSITORY_ROOT]" >&2
  exit 2
fi
version=$1
build=$2
output=$3
source_root=${4:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}
client_root="$source_root/clients/ios"
: "${IOS_CERTIFICATE_P12_BASE64:?Missing distribution certificate}"
: "${IOS_CERTIFICATE_PASSWORD:?Missing distribution certificate password}"
: "${IOS_PROVISIONING_PROFILE_BASE64:?Missing JSTorrent distribution profile}"

# shellcheck source=/dev/null
source "$source_root/scripts/dev-env.sh"

umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/jstorrent-ios-signing.XXXXXXXX")
keychain="$work/release.keychain-db"
installed_profile=
prior_keychains=()
while IFS= read -r path; do
  prior_keychains+=("$path")
done < <(security list-keychains -d user | sed -E 's/^[[:space:]]*"(.*)"[[:space:]]*$/\1/')
cleanup() {
  if [[ -e "$keychain" ]]; then
    security list-keychains -d user -s "${prior_keychains[@]}" || true
    security delete-keychain "$keychain" || true
  fi
  if [[ -n "$installed_profile" ]]; then rm -f "$installed_profile"; fi
  rm -rf "$work"
}
trap cleanup EXIT

printf '%s' "$IOS_CERTIFICATE_P12_BASE64" | base64 -D > "$work/certificate.p12"
printf '%s' "$IOS_PROVISIONING_PROFILE_BASE64" | base64 -D > "$work/profile.mobileprovision"
security cms -D -i "$work/profile.mobileprovision" > "$work/profile.plist"
IFS=$'\t' read -r team profile_name profile_id certificate_hash < <(python3 - "$work/profile.plist" "$bundle_id" <<'PY'
import datetime
import hashlib
import plistlib
import re
import sys

with open(sys.argv[1], 'rb') as source:
    profile = plistlib.load(source)
team, = profile['TeamIdentifier']
entitlements = profile['Entitlements']
certificate, = profile['DeveloperCertificates']
assert re.fullmatch(r'[A-Z0-9]{10}', team), 'invalid signing team'
assert re.fullmatch(r'[a-fA-F0-9-]{36}', profile['UUID']), 'invalid profile identifier'
assert profile['ExpirationDate'].replace(tzinfo=datetime.timezone.utc) > datetime.datetime.now(datetime.timezone.utc), 'expired profile'
assert entitlements['application-identifier'] == f'{team}.{sys.argv[2]}', 'profile is for another app'
assert 'iOS' in profile['Platform'] and not profile.get('ProvisionedDevices'), 'expected App Store Connect profile'
assert not profile.get('ProvisionsAllDevices') and entitlements.get('get-task-allow') is False, 'expected non-debug distribution'
print(team, profile['Name'], profile['UUID'], hashlib.sha1(certificate).hexdigest().upper(), sep='\t')
PY
)

keychain_password=$(openssl rand -hex 24)
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security list-keychains -d user -s "$keychain" "${prior_keychains[@]}"
security import "$work/certificate.p12" -k "$keychain" -P "$IOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security find-identity -v -p codesigning "$keychain" | grep "$certificate_hash.*Apple Distribution" >/dev/null

profile_directory="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$profile_directory"
profile_path="$profile_directory/$profile_id.mobileprovision"
if [[ -e "$profile_path" ]]; then
  cmp "$work/profile.mobileprovision" "$profile_path"
else
  cp "$work/profile.mobileprovision" "$profile_path"
  installed_profile="$profile_path"
fi

mkdir "$output"
archive="$output/JSTorrent.xcarchive"
"$client_root/scripts/generate-project.sh"
xcodebuild -quiet -project "$client_root/RSTorrent.xcodeproj" -scheme RSTorrent \
  -configuration Distribution -destination 'generic/platform=iOS' -archivePath "$archive" \
  JSTORRENT_IOS_VERSION="$version" JSTORRENT_IOS_BUILD="$build" \
  JSTORRENT_IOS_TEAM="$team" JSTORRENT_IOS_PROFILE="$profile_name" archive

python3 - "$work/ExportOptions.plist" "$team" "$bundle_id" "$profile_name" <<'PY'
import plistlib
import sys

with open(sys.argv[1], 'wb') as output:
    plistlib.dump({
        'method': 'app-store-connect', 'destination': 'export', 'signingStyle': 'manual',
        'teamID': sys.argv[2], 'provisioningProfiles': {sys.argv[3]: sys.argv[4]},
        'manageAppVersionAndBuildNumber': False, 'uploadSymbols': True,
    }, output)
PY
xcodebuild -quiet -exportArchive -archivePath "$archive" \
  -exportOptionsPlist "$work/ExportOptions.plist" -exportPath "$work/export"
files=("$work/export/"*.ipa)
[[ ${#files[@]} -eq 1 && -f "${files[0]}" ]]
ditto -x -k "${files[0]}" "$work/ipa"
apps=("$work/ipa/Payload/"*.app)
[[ ${#apps[@]} -eq 1 && -d "${apps[0]}" ]]
app=${apps[0]}
codesign --verify --deep --strict "$app"
codesign -d --entitlements :- "$app" > "$work/entitlements.plist" 2>/dev/null
security cms -D -i "$app/embedded.mobileprovision" > "$work/exported-profile.plist"
python3 - "$app" "$work/entitlements.plist" "$work/exported-profile.plist" "$profile_id" "$bundle_id" "$team" "$version" "$build" <<'PY'
from pathlib import Path
import plistlib
import sys

app, entitlements_path, profile_path, profile_id, bundle, team, version, build = sys.argv[1:]
app = Path(app)
info = plistlib.loads((app / 'Info.plist').read_bytes())
entitlements = plistlib.loads(Path(entitlements_path).read_bytes())
profile = plistlib.loads(Path(profile_path).read_bytes())
assert info['CFBundleIdentifier'] == bundle and info['CFBundleShortVersionString'] == version
assert info['CFBundleVersion'] == build and info['BGTaskSchedulerPermittedIdentifiers'] == [f'{bundle}.continued-processing.*']
assert profile['UUID'] == profile_id and entitlements['application-identifier'] == f'{team}.{bundle}'
assert entitlements.get('get-task-allow') is not True
assert (app / 'PrivacyInfo.xcprivacy').is_file()
for framework in ('RSTorrentIOS', 'RSTorrentSession'):
    assert not (app / 'Frameworks' / f'{framework}.framework').exists(), f'embedded static binding {framework}'
PY
mv "${files[0]}" "$output/JSTorrent.ipa"
echo "Verified signed JSTorrent $version ($build) at $output/JSTorrent.ipa"
