import { execFileSync } from 'node:child_process';

// Match the public installer's strict path/type checks before an artifact can
// be published. Also exclude macOS metadata even when it sits under package/.
export function assertArchiveEntries(entries) {
  if (entries.length === 0 || entries.some(name =>
    !name.startsWith('package/') ||
    /[\x00-\x1f\x7f]/.test(name) ||
    name.split('/').some(part => part === '.' || part === '..' || part === '__MACOSX' || part.startsWith('._')) ||
    name.endsWith('/.DS_Store')
  )) throw new Error('Unsafe archive paths in generated release bundle');
}

export function assertArchiveTypes(listing) {
  if (listing.length === 0 || listing.some(line => !/^[d-]/.test(line))) {
    throw new Error('Unsafe archive entry types in generated release bundle');
  }
}

export function verifyReleaseArchive(destination) {
  const env = { ...process.env, COPYFILE_DISABLE: '1' };
  const entries = execFileSync('tar', ['-tzf', destination], { encoding: 'utf8', env }).trimEnd().split('\n');
  const types = execFileSync('tar', ['-tvzf', destination], { encoding: 'utf8', env }).trimEnd().split('\n');
  assertArchiveEntries(entries);
  assertArchiveTypes(types);
  if (entries.length !== types.length) throw new Error('Archive listing count mismatch');
  return entries;
}
