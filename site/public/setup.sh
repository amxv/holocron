#!/bin/sh
# Fixed public prerequisite bootstrap; private Holocron release uses this device's gh login.
set +x
set -eu
umask 077
fail() { printf 'Holocron setup: %s\n' "$1" >&2; exit 1; }
[ "$(id -u)" != 0 ] || fail 'Run as your regular OS user, without sudo.'
for hc_tool in curl tar mktemp; do command -v "$hc_tool" >/dev/null 2>&1 || fail "Install $hc_tool first."; done
hc_os=$(uname -s)
case "$hc_os" in Darwin) hc_platform=darwin; hc_gh_platform=macOS;; Linux) hc_platform=linux; hc_gh_platform=linux;; *) fail 'Only macOS and Linux are supported.';; esac
case "$(uname -m)" in arm64|aarch64) hc_arch=arm64; hc_gh_arch=arm64;; x86_64|amd64) hc_arch=x64; hc_gh_arch=amd64;; *) fail 'Unsupported CPU architecture.';; esac
hc_home=$(cd "${HOME:?HOME is required}" && pwd -P)
hc_tools=$hc_home/.local/share/holocron-tools
hc_temp=$(mktemp -d "${TMPDIR:-/tmp}/holocron-setup.XXXXXXXX")
hc_stage=
hc_locked=false
trap 'rm -rf "$hc_temp"; [ -z "$hc_stage" ] || rm -rf "$hc_stage"; [ "$hc_locked" != true ] || rmdir "$hc_tools/bootstrap.lock"' EXIT
trap 'exit 1' HUP INT TERM
hc_hash() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
hc_private() {
  # Never chmod/adopt an existing path. Refuse symlink/shared/foreign ancestors.
  hc_path=$1
  if [ ! -e "$hc_path" ]; then mkdir -m 700 "$hc_path" || fail 'Cannot create private prerequisite directory.'; fi
  [ -d "$hc_path" ] && [ ! -L "$hc_path" ] || fail 'Unsafe prerequisite directory.'
  if [ "$hc_os" = Darwin ]; then hc_meta=$(stat -f '%u %Lp' "$hc_path"); else hc_meta=$(stat -c '%u %a' "$hc_path"); fi
  [ "$hc_meta" = "$(id -u) 700" ] || fail 'Prerequisite directory must be owned by you with mode 0700.'
}
hc_fetch() { curl --proto '=https' --tlsv1.2 -fsSL "$1" -o "$2" || fail 'Prerequisite download failed; retry when connected.'; }
hc_publish_binary() {
  hc_target=$1; hc_source=$2; hc_expected=$3
  hc_private "$hc_tools"
  if [ "$hc_locked" != true ]; then mkdir -m 700 "$hc_tools/bootstrap.lock" || fail 'Prerequisite installation is busy or interrupted; inspect bootstrap.lock.'; hc_locked=true; fi
  [ ! -e "$hc_target" ] && [ ! -L "$hc_target" ] || fail 'Conflicting managed prerequisite; retry after the other setup finishes.'
  hc_stage=$(mktemp -d "$hc_tools/.stage.XXXXXXXX")
  mkdir -m 700 "$hc_stage/bin"
  cp "$hc_source" "$hc_stage/bin/$hc_expected"
  chmod 700 "$hc_stage/bin/$hc_expected"
  printf 'holocron-tool-v1 %s %s\n' "$hc_expected" "$(hc_hash "$hc_stage/bin/$hc_expected")" > "$hc_stage/.holocron-tool"
  mv "$hc_stage" "$hc_target"
  hc_stage=
}
hc_verify_binary() {
  hc_target=$1; hc_expected=$2
  [ -f "$hc_target/bin/$hc_expected" ] && [ ! -L "$hc_target/bin/$hc_expected" ] &&
    [ -f "$hc_target/.holocron-tool" ] && [ ! -L "$hc_target/.holocron-tool" ] || fail 'Unrecognized managed prerequisite; inspect it before retrying.'
  if [ "$hc_os" = Darwin ]; then
    hc_meta=$(stat -f '%u %Lp' "$hc_target/bin/$hc_expected"); hc_marker_meta=$(stat -f '%u %Lp' "$hc_target/.holocron-tool")
  else hc_meta=$(stat -c '%u %a' "$hc_target/bin/$hc_expected"); hc_marker_meta=$(stat -c '%u %a' "$hc_target/.holocron-tool"); fi
  [ "$hc_meta" = "$(id -u) 700" ] && [ "$hc_marker_meta" = "$(id -u) 600" ] || fail 'Unsafe managed prerequisite.'
  [ "$(cat "$hc_target/.holocron-tool")" = "holocron-tool-v1 $hc_expected $(hc_hash "$hc_target/bin/$hc_expected")" ] || fail 'Managed prerequisite changed; inspect it before retrying.'
}
if ! command -v node >/dev/null 2>&1 || [ "$(node --version 2>/dev/null || true)" != v24.21.0 ]; then
  for hc_part in "$hc_home/.local" "$hc_home/.local/share"; do
    if [ ! -e "$hc_part" ]; then mkdir -m 700 "$hc_part"; fi
    [ -d "$hc_part" ] && [ ! -L "$hc_part" ] || fail 'Unsafe prerequisite ancestor.'
    if [ "$hc_os" = Darwin ]; then hc_meta=$(stat -f '%u %Lp' "$hc_part"); else hc_meta=$(stat -c '%u %a' "$hc_part"); fi
    case "$hc_meta" in "$(id -u) 700"|"$(id -u) 755") ;; *) fail 'Unsafe prerequisite ancestor permissions.';; esac
  done
  hc_node_root=$hc_tools/node-24.21.0
  if [ ! -e "$hc_node_root" ]; then
    case "$hc_platform-$hc_arch" in
      darwin-arm64) hc_digest=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057;;
      darwin-x64) hc_digest=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097;;
      linux-arm64) hc_digest=724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5;;
      linux-x64) hc_digest=6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff;;
    esac
    hc_name=node-v24.21.0-$hc_platform-$hc_arch
    hc_fetch "https://nodejs.org/dist/v24.21.0/$hc_name.tar.gz" "$hc_temp/node.tgz"
    [ "$(hc_hash "$hc_temp/node.tgz")" = "$hc_digest" ] || fail 'Node integrity check failed.'
    tar -xzf "$hc_temp/node.tgz" -C "$hc_temp" "$hc_name/bin/node"
    hc_publish_binary "$hc_node_root" "$hc_temp/$hc_name/bin/node" node
  fi
  hc_private "$hc_tools"; hc_private "$hc_node_root"; hc_private "$hc_node_root/bin"
  hc_verify_binary "$hc_node_root" node
  PATH=$hc_node_root/bin:$PATH; export PATH
fi
[ "$(node --version)" = v24.21.0 ] || fail 'Managed Node is incomplete; inspect its private directory.'
if ! command -v gh >/dev/null 2>&1; then
  # Node now validates paths and ownership before touching this dedicated tools root.
  node --input-type=module - "$hc_tools" <<'JS'
import { lstatSync, mkdirSync } from 'node:fs';
import { parse, join } from 'node:path';
let part = parse(process.argv[2]).root;
for (const name of process.argv[2].slice(part.length).split('/')) {
  part = join(part, name); if (!name) continue;
  try { mkdirSync(part, {mode:0o700}); } catch (e) { if(e.code !== 'EEXIST') throw e; }
  const s=lstatSync(part);
  if(!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o022) && !(s.uid===0 && s.mode & 0o1000) || part===process.argv[2] && (s.uid!==process.getuid() || (s.mode & 0o777)!==0o700)) process.exit(1);
}
JS
  hc_gh_root=$hc_tools/gh-2.102.0
  if [ ! -e "$hc_gh_root" ]; then
    case "$hc_platform-$hc_arch" in
      linux-x64) hc_digest=bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386;;
      linux-arm64) hc_digest=7862c86c72f43df3a2d93ddde6f473285b4e2af61b494849846827e513ef6484;;
      darwin-x64) hc_digest=b245f24eb2bf5f75b426b4c26da3651a107f8d5b6f4fddfbfccc5679041378b3;;
      darwin-arm64) hc_digest=da922c20d1792e5b2cbf375593d7a658acf034c12c84e007e71c76ef959c337e;;
    esac
    hc_name=gh_2.102.0_${hc_gh_platform}_${hc_gh_arch}
    hc_extension=tar.gz; [ "$hc_os" != Darwin ] || hc_extension=zip
    hc_fetch "https://github.com/cli/cli/releases/download/v2.102.0/$hc_name.$hc_extension" "$hc_temp/gh.$hc_extension"
    [ "$(hc_hash "$hc_temp/gh.$hc_extension")" = "$hc_digest" ] || fail 'GitHub CLI integrity check failed.'
    if [ "$hc_os" = Darwin ]; then
      command -v unzip >/dev/null 2>&1 || fail 'Install unzip first.'
      unzip -q "$hc_temp/gh.zip" "$hc_name/bin/gh" -d "$hc_temp"
    else tar -xzf "$hc_temp/gh.tar.gz" -C "$hc_temp" "$hc_name/bin/gh"; fi
    hc_publish_binary "$hc_gh_root" "$hc_temp/$hc_name/bin/gh" gh
  fi
  hc_private "$hc_gh_root"; hc_private "$hc_gh_root/bin"
  hc_verify_binary "$hc_gh_root" gh
  PATH=$hc_gh_root/bin:$PATH; export PATH
fi
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  printf '%s\n' 'This computer needs its own GitHub account with read access to the private amxv/holocron repository.' >&2
  if ( : </dev/tty ) 2>/dev/null; then gh auth login --hostname github.com --git-protocol https --web </dev/tty >/dev/tty 2>&1;
  else printf 'Have the device owner run: %s auth login --hostname github.com --git-protocol https --web\nThen repeat this setup command.\n' "$(command -v gh)" >&2; exit 1; fi
fi
hc_fetch https://holocron.ashray.xyz/install.sh "$hc_temp/install.sh"
sh "$hc_temp/install.sh" --version 0.3.0
if [ "$hc_os" = Darwin ] && [ "${1:-}" != receiver ] && ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  /usr/bin/xcode-select --install >/dev/null 2>&1 || true
  fail 'Complete the native Command Line Tools installation, then repeat this command.'
fi
"$hc_home/.local/bin/holocron" setup "$@"
