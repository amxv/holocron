#!/bin/sh
# Public bootstrap. The Holocron implementation is downloaded from its public GitHub release.
set -eu
umask 077
holocron_version=0.3.4
holocron_prefix=${HOME:?HOME is required}/.local/share/holocron-cli
holocron_bin=${HOME}/.local/bin
holocron_attestation=false
fail() { printf 'Holocron install: %s\n' "$1" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--prefix|--bin-dir)
      [ "$#" -ge 2 ] || fail "Missing value for $1"
      case "$1" in --version) holocron_version=$2;; --prefix) holocron_prefix=$2;; --bin-dir) holocron_bin=$2;; esac
      shift 2;;
    --attestation) holocron_attestation=true; shift;;
    --help)
      printf '%s\n' 'Usage: sh install.sh [--version X.Y.Z] [--prefix ABS] [--bin-dir ABS] [--attestation]' \
        'Requires Node 24.21.0, curl, tar and mktemp. Optional --attestation additionally requires authenticated gh.' \
        'Installs only a user-local CLI. No config/state/clipboard/runtime changes. Never use sudo.'
      exit 0;;
    *) fail "Unknown option $1";;
  esac
done
[ "$(id -u)" != 0 ] || fail 'Run as your regular OS user, without sudo.'
case "$(uname -s)" in Darwin|Linux) ;; *) fail 'Only macOS and Linux are supported.';; esac
for holocron_tool in node curl tar mktemp; do command -v "$holocron_tool" >/dev/null 2>&1 || fail "Install $holocron_tool first, then retry."; done
[ "$(node --version)" = v24.21.0 ] || fail 'Activate Node 24.21.0 with your Node manager, then retry.'
node -e 'if (!/^\d+\.\d+\.\d+$/.test(process.argv[1])) process.exit(1)' "$holocron_version" || fail 'Version must be X.Y.Z.'
holocron_node=$(node -p 'process.execPath')
holocron_temp=$(mktemp -d "${TMPDIR:-/tmp}/holocron-install.XXXXXXXX")
trap 'rm -rf "$holocron_temp"' EXIT
trap 'exit 1' HUP INT TERM
holocron_tag=holocron-v${holocron_version}
holocron_asset=holocron-${holocron_version}.tgz
# Public release metadata and assets are fetched anonymously over HTTPS.
curl --proto '=https' --tlsv1.2 -fsSL \
  -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/amxv/holocron/releases/tags/$holocron_tag" \
  -o "$holocron_temp/release.json" || fail 'Release unavailable. Check the published version and retry.'
curl --proto '=https' --tlsv1.2 -fsSL \
  "https://github.com/amxv/holocron/releases/download/$holocron_tag/$holocron_asset" \
  -o "$holocron_temp/$holocron_asset" || fail 'Release asset download failed. Check the published version and retry.'
# Require the SHA-256 recorded by GitHub for this exact published asset.
holocron_digest=$(node --input-type=module - "$holocron_temp/release.json" "$holocron_temp/$holocron_asset" "$holocron_tag" "$holocron_asset" <<'JS'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [metadata, file, tag, name] = process.argv.slice(2);
try {
  const release = JSON.parse(readFileSync(metadata));
  const assets = release.assets.filter(asset => asset.name === name);
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (release.draft || release.tag_name !== tag || assets.length !== 1 ||
      assets[0].digest !== `sha256:${digest}` || assets[0].size !== readFileSync(file).length) process.exit(1);
  console.log(digest);
} catch { process.exit(1); }
JS
) || fail 'Release integrity check failed or the asset has no GitHub SHA-256. Nothing was installed.'
if [ "$holocron_attestation" = true ]; then
  command -v gh >/dev/null 2>&1 || fail 'Requested attestation verification requires GitHub CLI (gh).'
  gh release verify-asset "$holocron_tag" "$holocron_temp/$holocron_asset" --repo github.com/amxv/holocron >/dev/null 2>&1 || \
    fail 'Requested release attestation verification failed. Authenticate gh if needed, then retry.'
fi
tar -tzf "$holocron_temp/$holocron_asset" > "$holocron_temp/entries" || fail 'Invalid release archive.'
if ! node --input-type=module - "$holocron_temp/entries" <<'JS'
import { readFileSync } from 'node:fs';
const entries = readFileSync(process.argv[2], 'utf8').trimEnd().split('\n');
if (!entries.length || entries.some(name => !name.startsWith('package/') || /[\x00-\x1f\x7f]/.test(name) || name.split('/').some(part => part === '..' || part === '.'))) process.exit(1);
JS
then fail 'Unsafe archive paths.'; fi
# Release bundles contain only directories and regular files, never links or special devices.
tar -tvzf "$holocron_temp/$holocron_asset" > "$holocron_temp/types" || fail 'Invalid release archive.'
awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }' "$holocron_temp/types" || fail 'Unsafe archive entry types.'
tar -xzf "$holocron_temp/$holocron_asset" -C "$holocron_temp" || fail 'Release extraction failed.'
"$holocron_node" "$holocron_temp/package/dist/install.js" "$holocron_prefix" "$holocron_bin" "$holocron_node" \
  "$holocron_temp/package" "$holocron_version" "$holocron_digest"
