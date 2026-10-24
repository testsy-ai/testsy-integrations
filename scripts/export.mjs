#!/usr/bin/env node
import {cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build, root} from './build.mjs';
import {skillNames} from './validate.mjs';

// A reviewed allowlist, rather than a recursive copy of the private parent checkout.
export const sourceFiles = [
  '.gitignore', '.github/workflows/validate.yml', 'LICENSE', 'README.md', 'RELEASING.md', 'package.json', 'config.json', 'server.json', 'action.yml',
  'bin/testsy.mjs', 'examples/prompts.md',
  ...['claude.mcp.json', 'claude.plugin.json', 'codex.plugin.json', 'cursor.mcp.json', 'cursor.plugin.json',
    'gemini-extension.json', 'oauth.mcp.json', 'portable.plugin.json'].map(name => `manifests/${name}`),
  ...skillNames.map(name => `skills/${name}/SKILL.md`),
  ...['build.mjs', 'export.mjs', 'archive.mjs', 'generated.mjs', 'generated.d.mts', 'validate.mjs'].map(name => `scripts/${name}`),
  'tests/action.test.mjs', 'tests/package.test.mjs',
];
export const releaseTargets = ['source', 'codex', 'claude', 'cursor', 'gemini', 'portable-skills',
  'openai-oauth-candidate', 'action', 'registry', 'claude-marketplace', 'codex-marketplace'];

/** Prepare separate repository roots. This never initializes Git, publishes or calls the service. */
export function exportRelease(destination = join(root, 'release')) {
  const out = resolve(destination);
  if (out !== join(root, 'release')) throw new Error('Export destination must be the package release directory.');
  const built = build();
  rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
  for (const name of sourceFiles) {
    const target = join(out, 'source', name);
    mkdirSync(dirname(target), {recursive: true}); cpSync(join(root, name), target);
  }
  for (const name of releaseTargets.filter(name => name !== 'source')) cpSync(join(built, name), join(out, name), {recursive: true});
  cpSync(join(built, 'release.json'), join(out, 'release.json'));
  const files = {};
  function inventory(folder) {
    for (const entry of readdirSync(folder, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) inventory(path);
      else files[relative(out, path).split('\\').join('/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  }
  inventory(out);
  writeFileSync(join(out, 'export.json'), JSON.stringify({
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    targets: releaseTargets, files,
    publication: 'Prepared local files only. No Git repository, public listing or live-client validation created.',
  }, null, 2) + '\n');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('npm run export accepts no destination arguments.');
  console.log(`Prepared standalone repository roots in ${exportRelease()}`);
}
