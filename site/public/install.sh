#!/bin/sh
# Public bootstrap only. The Board implementation is downloaded from its PRIVATE release.
set -eu
umask 077
board_version=0.1.0
board_prefix=${HOME:?HOME is required}/.local/share/board-cli
board_bin=${HOME}/.local/bin
board_attestation=false
fail() { printf 'Board install: %s\n' "$1" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--prefix|--bin-dir)
      [ "$#" -ge 2 ] || fail "Missing value for $1"
      case "$1" in --version) board_version=$2;; --prefix) board_prefix=$2;; --bin-dir) board_bin=$2;; esac
      shift 2;;
    --attestation) board_attestation=true; shift;;
    --help)
      printf '%s\n' 'Usage: sh install.sh [--version X.Y.Z] [--prefix ABS] [--bin-dir ABS] [--attestation]' \
        'Requires Node 24.21.0, authenticated gh with read access to amxv/shared-clipboard, and tar.' \
        'Installs only a user-local CLI. No config/state/clipboard/runtime changes. Never use sudo.'
      exit 0;;
    *) fail "Unknown option $1";;
  esac
done
[ "$(id -u)" != 0 ] || fail 'Run as your regular OS user, without sudo.'
case "$(uname -s)" in Darwin|Linux) ;; *) fail 'Only macOS and Linux are supported.';; esac
for board_tool in node gh tar mktemp; do command -v "$board_tool" >/dev/null 2>&1 || fail "Install $board_tool first, then retry."; done
[ "$(node --version)" = v24.21.0 ] || fail 'Activate Node 24.21.0 with your Node manager, then retry.'
node -e 'if (!/^\d+\.\d+\.\d+$/.test(process.argv[1])) process.exit(1)' "$board_version" || fail 'Version must be X.Y.Z.'
board_node=$(node -p 'process.execPath')
board_temp=$(mktemp -d "${TMPDIR:-/tmp}/board-install.XXXXXXXX")
trap 'rm -rf "$board_temp"' EXIT
trap 'exit 1' HUP INT TERM
board_tag=board-v${board_version}
board_asset=board-${board_version}.tgz
# gh manages authentication. Never request, extract, print, or copy its credential.
gh api --hostname github.com "repos/amxv/shared-clipboard/releases/tags/$board_tag" > "$board_temp/release.json" 2>/dev/null || \
  fail 'Release unavailable. Check the published version and your existing gh access to the private repository.'
gh release download "$board_tag" --repo github.com/amxv/shared-clipboard --pattern "$board_asset" --dir "$board_temp" 2>/dev/null || \
  fail 'Private release download failed. Check gh access and retry.'
# Require the SHA-256 recorded by GitHub for this exact published asset.
board_digest=$(node --input-type=module - "$board_temp/release.json" "$board_temp/$board_asset" "$board_tag" "$board_asset" <<'JS'
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
if [ "$board_attestation" = true ]; then
  gh release verify-asset "$board_tag" "$board_temp/$board_asset" --repo github.com/amxv/shared-clipboard >/dev/null 2>&1 || \
    fail 'Requested release attestation verification failed. Nothing was installed.'
fi
tar -tzf "$board_temp/$board_asset" > "$board_temp/entries" || fail 'Invalid release archive.'
if ! node --input-type=module - "$board_temp/entries" <<'JS'
import { readFileSync } from 'node:fs';
const entries = readFileSync(process.argv[2], 'utf8').trimEnd().split('\n');
if (!entries.length || entries.some(name => !name.startsWith('package/') || /[\x00-\x1f\x7f]/.test(name) || name.split('/').some(part => part === '..' || part === '.'))) process.exit(1);
JS
then fail 'Unsafe archive paths.'; fi
# Release bundles contain only directories and regular files, never links or special devices.
tar -tvzf "$board_temp/$board_asset" > "$board_temp/types" || fail 'Invalid release archive.'
awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }' "$board_temp/types" || fail 'Unsafe archive entry types.'
tar -xzf "$board_temp/$board_asset" -C "$board_temp" || fail 'Release extraction failed.'
"$board_node" "$board_temp/package/dist/install.js" "$board_prefix" "$board_bin" "$board_node" \
  "$board_temp/package" "$board_version" "$board_digest"
