#!/usr/bin/env node
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, lstatSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = name => readFileSync(join(root, name), 'utf8');
const load = name => JSON.parse(read(name));
export const skillNames = ['testsy-check-release', 'testsy-investigate-run', 'testsy-regression-from-bug'];

/** Local integrity and auth-wiring checks, not a substitute for host-side/client validation. */
/** Lines whose plain (unquoted, not block) mapping value contains ": " — invalid YAML ("mapping values are not allowed").
 * The 2026-11-02 action broke this way in GitHub while every local check, which only runs the step's script, passed. */
export function plainColons(text) {
  const out = []; let block = -1;
  text.split('\n').forEach((line, i) => {
    const ind = line.match(/^ */)[0].length;
    if (block >= 0 && (ind > block || !line.trim())) return; block = -1;
    const m = /^\s*(?:- )?[\w.-]+:\s+(.*)$/.exec(line); if (!m) return;
    const v = m[1].replace(/\s+#.*$/, '');
    if (/^[|>]/.test(v)) { block = ind; return; }
    if (/^["'{[&*!]/.test(v) || /^\$\{\{/.test(v)) return;
    if (/: /.test(v)) out.push(i + 1);
  });
  return out;
}

export function validate() {
  const version = load('package.json').version, config = load('config.json');
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const value of [config.app, config.landing, ...Object.values(config.repos ?? {})]) assert.equal(new URL(value).protocol, 'https:');
  const files = [];
  function walk(folder) {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      if (['dist', 'release', 'node_modules', '.git'].includes(entry.name)) continue;
      const path = join(folder, entry.name);
      assert.equal(lstatSync(path).isSymbolicLink(), false, `Package must not include symlinks: ${path}`);
      if (entry.isDirectory()) walk(path); else files.push(path);
    }
  }
  walk(root);
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    assert.doesNotMatch(text, /\bqa_[A-Za-z0-9]{24,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, `Possible embedded secret: ${path}`);
    assert.doesNotMatch(text, /qa-app\.[a-z0-9-]+\.workers\.dev/, `Retired production host: ${path}`);
  }
  for (const name of skillNames) {
    const body = read(`skills/${name}/SKILL.md`), front = /^---\n([\s\S]+?)\n---\n/.exec(body)?.[1];
    assert.ok(front, `Missing skill frontmatter: ${name}`);
    assert.equal(/^name: (.+)$/m.exec(front)?.[1], name);
    assert.ok(/^description: .{30,}$/m.test(front), `Missing discovery description: ${name}`);
    assert.doesNotMatch(body, /\bTODO\b|\[INSERT|\[TBD/);
  }
  for (const name of ['portable.plugin.json', 'codex.plugin.json', 'claude.plugin.json', 'cursor.plugin.json', 'gemini-extension.json']) {
    const manifest = load(`manifests/${name}`);
    assert.equal(manifest.name, 'testsy'); assert.equal(manifest.version, version);
    assert.ok(manifest.description.length > 20);
    if (manifest.license) assert.equal(manifest.license, 'MIT');
  }
  const portable = load('manifests/portable.plugin.json');
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.deepEqual(Object.keys(portable).sort(), ['$schema', 'author', 'description', 'extensions', 'homepage', 'keywords', 'license', 'name', 'version'].sort());
  assert.equal(load('manifests/codex.plugin.json').mcpServers, undefined, 'Codex key authentication is configured using bearer-token-env-var, never literal portable headers.');
  for (const name of ['claude.mcp.json', 'cursor.mcp.json']) {
    const server = load(`manifests/${name}`).mcpServers.testsy;
    assert.equal(server.url, `${config.app}/mcp`);
    assert.equal(server.headers.Authorization, 'Bearer ${TESTSY_AI_API_KEY}');
  }
  assert.deepEqual(load('manifests/cursor.plugin.json').variables.required, ['TESTSY_AI_API_KEY']);
  const gemini = load('manifests/gemini-extension.json');
  assert.equal(gemini.mcpServers.testsy.httpUrl, `${config.app}/mcp`);
  assert.equal(gemini.mcpServers.testsy.headers.Authorization, 'Bearer ${TESTSY_AI_API_KEY}');
  assert.equal(gemini.settings.find(x => x.envVar === 'TESTSY_AI_API_KEY')?.sensitive, true);
  const oauth = load('manifests/oauth.mcp.json');
  assert.equal(oauth.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(oauth.mcpServers.testsy, {type: 'streamable-http', url: `${config.app}/mcp`});
  const registry = load('server.json');
  assert.equal(registry.name, 'dev.testsy/testsy'); assert.equal(registry.version, version);
  assert.equal(registry.remotes[0].url, `${config.app}/mcp`);
  assert.equal(registry.remotes[0].headers[0].isSecret, true);
  const action = read('action.yml');
  const legacy = new URL('../../../apps/customer/integrations/github-action/action.yml', import.meta.url);   // only inside app-qa-ai
  for (const [name, text] of [['action.yml', action], ...(existsSync(legacy) ? [['apps/customer/integrations/github-action/action.yml', readFileSync(legacy, 'utf8')]] : [])]) {
    const bad = plainColons(text);
    assert.equal(bad.length, 0, `${name}: a plain YAML value contains ": " and GitHub refuses the action (quote it or reword): line ${bad.join(', ')}`);
  }
  assert.ok(action.includes(`default: ${config.app}`));
  assert.ok(action.includes('node "$GITHUB_ACTION_PATH/bin/testsy.mjs" "$@"'));
  assert.doesNotMatch(action, /curl|wget|npx|eval\s/);
  assert.doesNotMatch(action, /\{[^\n]*\$\{\{/); // GitHub expressions cannot be used inside YAML flow mappings.
  const source = new URL('../../../apps/customer/public/cli/testsy-ai.mjs', import.meta.url);
  if (existsSync(source)) assert.equal(read('bin/testsy.mjs'), readFileSync(source, 'utf8'), 'Run parent config-gen to refresh the pinned CLI.');
  return {version, skills: skillNames.length, files: files.length};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log('Validated local integration package:', validate());
