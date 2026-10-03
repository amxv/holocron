import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const output = resolve(process.argv[2] ?? 'tmp/gg/releases');
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
if (process.version !== 'v24.21.0') throw new Error('Activate Node 24.21.0');
const temporary = await mkdtemp(join(await realpath('/tmp'), 'board-release-'));
try {
  const bundle = join(temporary, 'package'); await mkdir(bundle, { mode: 0o700 });
  for (const name of ['package.json', 'package-lock.json', 'README.md', 'dist', 'docs', 'plugins']) {
    await cp(join(root, name), join(bundle, name), { recursive: true });
  }
  // npm verifies the committed lockfile integrity; no dependency lifecycle scripts run.
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: bundle, stdio: 'inherit', env: { ...process.env, npm_config_userconfig: join(temporary, 'empty-npmrc') },
  });
  await rm(join(bundle, 'node_modules', '.bin'), { recursive: true, force: true });
  async function noLinks(directory) {
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry); const info = await lstat(path);
      if (info.isDirectory()) await noLinks(path);
      else if (!info.isFile() || info.nlink !== 1) throw new Error('Release bundle must contain only regular files and directories');
    }
  }
  await noLinks(bundle);
  execFileSync(process.execPath, [join(bundle, 'dist/board.js'), '--version'], { stdio: 'inherit' });
  execFileSync(process.execPath, [join(bundle, 'dist/cli.js'), '--help'], { stdio: 'ignore' });
  execFileSync(process.execPath, [join(bundle, 'dist/cloud-cli.js'), '--help'], { stdio: 'ignore' });
  await mkdir(output, { recursive: true });
  const asset = `board-${manifest.version}.tgz`; const destination = join(output, asset);
  try { await lstat(destination); throw new Error('Release artifact already exists; choose a fresh output directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  execFileSync('tar', ['-czf', destination, '-C', temporary, 'package']);
  const digest = createHash('sha256').update(await readFile(destination)).digest('hex');
  await writeFile(join(output, 'SHA256SUMS'), `${digest}  ${asset}\n`, { flag: 'wx' });
  console.log(`Production-only bundle: ${destination}\nSHA-256: ${digest}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
