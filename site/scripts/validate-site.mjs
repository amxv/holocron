import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { TEXT_LIMIT, FILE_LIMIT, AGGREGATE_LIMIT, READ_LIMIT, SHARE_TTL_MS, REQUEST_TTL_MS, RECEIPT_TTL_MS } from '../../src/text.ts';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(site, 'dist');
const content = join(site, '..', 'docs');
const origin = 'https://holocron.ashray.xyz';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function destination(pathname) {
  const path = join(output, decodeURIComponent(pathname));
  for (const candidate of [path, join(path, 'index.html'), `${path}.html`]) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

const decode = (text) => text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const htmlFiles = (await files(output)).filter((path) => path.endsWith('.html'));
const documents = new Map(await Promise.all(htmlFiles.map(async (path) => [path, await readFile(path, 'utf8')])));
const ids = new Map([...documents].map(([path, html]) => [path,
  new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => decode(match[1])))
]));

let links = 0;
for (const [path, html] of documents) {
  const relative = path.slice(output.length).replace(/\/index\.html$/, '/') || '/';
  const canonical = relative === '/404.html' ? '/404' : relative.replace(/\/$/, '') || '/';
  assert.match(html, /<html[^>]+lang="en"/, `${path}: missing language`);
  assert.match(html, /<title>[^<]*Holocron[^<]*<\/title>/, `${path}: missing Holocron title`);
  assert.match(html, /<meta name="description" content="[^"]+"/, `${path}: missing description`);
  assert.ok(html.includes(`rel="canonical" href="${origin}${canonical}"`), `${path}: wrong canonical`);
  assert.match(html, /property="og:description"/, `${path}: missing social metadata`);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1, `${path}: expected one page heading`);
  // Script bodies include Pagefind result templates, not rendered navigation.
  // Keep script opening tags so their actual bundle src is still checked.
  const renderedHtml = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/g, '$1</script>');
  for (const match of renderedHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const href = decode(match[1]);
    if (!href || href === '#' || /^(?:mailto:|tel:|data:)/.test(href)) continue;
    const target = new URL(href, `${origin}${relative}`);
    if (target.origin !== origin) continue;
    const targetPath = await destination(target.pathname);
    assert.ok(targetPath, `${path}: broken link ${href}`);
    if (target.hash && targetPath.endsWith('.html')) {
      assert.ok(ids.get(targetPath)?.has(decodeURIComponent(target.hash.slice(1))), `${path}: missing anchor ${href}`);
    }
    links++;
  }
}

const names = (await readdir(content)).filter((name) => name.endsWith('.md')).sort();
assert.equal(names.length, 10, 'Unexpected canonical guide count; update this validation when adding a guide');
for (const name of names) {
  const source = await readFile(join(content, name), 'utf8');
  const slug = name.slice(0, -3);
  assert.match(source, /^---\ntitle: /, `${name}: missing metadata`);
  assert.ok(await destination(`/docs/${slug}`), `${name}: missing HTML route`);
  const raw = await destination(`/docs/${name}`);
  assert.ok(raw, `${name}: missing Markdown route`);
  assert.equal(await readFile(raw, 'utf8'), source, `${name}: website and package content drifted`);
  for (const match of source.matchAll(/\]\(([\w-]+\.md)(#[\w-]+)?\)/g)) {
    assert.ok(names.includes(match[1]), `${name}: broken canonical Markdown link ${match[1]}`);
    if (match[2]) {
      const target = await destination(`/docs/${match[1].slice(0, -3)}`);
      assert.ok(ids.get(target)?.has(match[2].slice(1)), `${name}: broken canonical anchor ${match[0]}`);
    }
  }
}

const pagefind = JSON.parse(await readFile(join(output, 'pagefind', 'pagefind-entry.json'), 'utf8'));
const indexed = Object.values(pagefind.languages).reduce((total, language) => total + language.page_count, 0);
assert.equal(indexed, names.length, 'Search must index every canonical guide');
const sitemap = await readFile(join(output, 'sitemap.xml'), 'utf8');
for (const name of names) assert.ok(sitemap.includes(`${origin}/docs/${name.slice(0, -3)}`), `${name}: missing sitemap route`);
assert.ok((await readFile(join(output, 'robots.txt'), 'utf8')).includes(`${origin}/sitemap.xml`));
assert.match(await readFile(join(output, 'font-notices.txt'), 'utf8'), /SIL OPEN FONT LICENSE/);
assert.deepEqual(await readFile(join(output, 'install.sh')), await readFile(join(site, 'public', 'install.sh')), 'Published bootstrap must match maintained source');
execFileSync('sh', ['-n', join(output, 'install.sh')]);

// Cover both maintained source and public text bundles. Never scan/copy private runtime state.
const maintained = [
  ...await files(join(site, 'src')), ...await files(join(site, 'scripts')),
  ...await files(join(site, 'public')),
  ...['package.json', 'package-lock.json', 'astro.config.mjs', 'vercel.json', 'README.md'].map((name) => join(site, name)),
  ...names.map((name) => join(content, name)), join(site, '..', 'README.md')
];
const bundles = (await files(output)).filter((path) => /\.(?:html|md|js|css|json|xml|txt|svg|sh)$/.test(path));
const sensitive = /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|sk-(?:proj|svcacct)-|\/Users\/|plugin_asdk_app_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/;
for (const path of new Set([...maintained, ...bundles])) {
  const text = await readFile(path, 'utf8');
  assert.doesNotMatch(text, sensitive, `${path}: sensitive material`);
  if (/\.(?:ts|mjs|astro|css)$/.test(path) && path.startsWith(site) && !path.startsWith(output)) {
    assert.ok(text.split('\n').length <= 1001, `${path}: exceeds 1000 lines`);
  }
}

const rootPackage = JSON.parse(await readFile(join(site, '..', 'package.json'), 'utf8'));
assert.equal(rootPackage.engines.node, '24.21.0');
assert.equal(rootPackage.packageManager, 'npm@11.19.0');
const reference = await readFile(join(content, 'reference.md'), 'utf8');
assert.ok(reference.includes(rootPackage.name) && reference.includes(`\`${rootPackage.version}\``), 'Package reference drifted');
for (const limit of [TEXT_LIMIT, FILE_LIMIT, AGGREGATE_LIMIT, READ_LIMIT]) {
  assert.ok(reference.includes(new Intl.NumberFormat('en-US').format(limit)), `Documented byte limit drifted: ${limit}`);
}
for (const [value, unit] of [[SHARE_TTL_MS / 3600000, 'hours'], [REQUEST_TTL_MS / 60000, 'minutes'], [RECEIPT_TTL_MS / 86400000, 'days']]) {
  const word = new Map([[5, 'five'], [7, 'Seven']]).get(value) ?? String(value);
  assert.ok(reference.includes(`${word} ${unit}`), `Documented lifetime drifted: ${value} ${unit}`);
}
const mcp = await readFile(join(site, '..', 'src', 'mcp.ts'), 'utf8');
for (const tool of ['get_bridge_status', 'read_synthetic_probe', 'list_shared_items', 'read_shared_item', 'copy_text_to_mac']) {
  assert.ok(mcp.includes(`registerTool('${tool}'`) && reference.includes(`\`${tool}\``), `Tool reference drifted: ${tool}`);
}

console.log(`Site validation passed: ${htmlFiles.length} HTML pages, ${names.length} identical canonical Markdown routes, ${indexed} searchable guides, ${links} internal links/assets, sitemap/metadata and public-content scan.`);
