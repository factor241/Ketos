#!/usr/bin/env bash
set -euo pipefail

# Ubuntu's package transaction scans the hosted image's full dpkg database and
# runs post-install hooks. CI needs only the signed-archive payload, so pin and
# verify that payload before extracting it into the ephemeral runner directory.
readonly BUBBLEWRAP_VERSION='0.9.0-1ubuntu0.1'
readonly BUBBLEWRAP_SHA256='1b506492bd9c7fd0cdb4f02ac822f1d3e336b0aead5113c1239baf8db5db562a'
# Launchpad keeps every published version, so its archive still serves the
# pinned 0.9.0-1ubuntu0.1 payload after archive.ubuntu.com replaces it with a
# newer point release and drops the old pool file. The Ubuntu archive stays as
# the fallback for the window in which both URLs serve the pinned version.
readonly BUBBLEWRAP_URL_PRIMARY="https://launchpad.net/ubuntu/+archive/primary/+files/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"
readonly BUBBLEWRAP_URL_FALLBACK="https://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"

: "${RUNNER_TEMP:?prepare-ci-bubblewrap requires RUNNER_TEMP}"
: "${GITHUB_PATH:?prepare-ci-bubblewrap requires GITHUB_PATH}"

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-bubblewrap supports only Linux x86_64 hosted runners' >&2
  exit 1
fi

archive="${RUNNER_TEMP}/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"
root="${RUNNER_TEMP}/dsh-bubblewrap"

download_bubblewrap() {
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors --output "$archive" "$1"
}

if ! download_bubblewrap "$BUBBLEWRAP_URL_PRIMARY"; then
  echo 'primary Launchpad URL unavailable; falling back to archive.ubuntu.com' >&2
  download_bubblewrap "$BUBBLEWRAP_URL_FALLBACK"
fi
printf '%s  %s\n' "$BUBBLEWRAP_SHA256" "$archive" | sha256sum --check --status
mkdir -p "$root"
dpkg-deb --extract "$archive" "$root"
printf '%s\n' "$root/usr/bin" >> "$GITHUB_PATH"

sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 \
  || echo 'apparmor userns knob absent — the functional probe decides'
"$root/usr/bin/bwrap" --version
"$root/usr/bin/bwrap" --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true
echo 'bubblewrap functional probe passed'
