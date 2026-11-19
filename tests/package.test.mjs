import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {build, root} from '../scripts/build.mjs';
import {exportRelease, releaseTargets, sourceFiles} from '../scripts/export.mjs';
import {archive, portableGzip, skillZip} from '../scripts/archive.mjs';
import {generatedFiles} from '../scripts/generated.mjs';
import {validate, skillNames} from '../scripts/validate.mjs';

test('packages contain only their client-specific wiring and identical canonical skills', () => {
  const out = build();
  const required = {codex: '.codex-plugin/plugin.json', claude: '.claude-plugin/plugin.json', cursor: '.cursor-plugin/plugin.json',
    gemini: 'gemini-extension.json', 'portable-skills': 'plugin.json', 'openai-oauth-candidate': 'mcp.json', action: 'bin/testsy.mjs', registry: 'server.json'};
  for (const [folder, entry] of Object.entries(required)) assert.ok(existsSync(join(out, folder, entry)), `${folder}/${entry}`);
  for (const folder of ['codex', 'claude', 'cursor', 'gemini', 'portable-skills', 'openai-oauth-candidate']) {
    for (const name of skillNames) assert.equal(readFileSync(join(out, folder, 'skills', name, 'SKILL.md'), 'utf8'), readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8'));
    assert.equal(existsSync(join(out, folder, '.env')), false);
    assert.equal(existsSync(join(out, folder, 'node_modules')), false);
  }
  assert.equal(existsSync(join(out, 'codex', '.mcp.json')), false, 'Codex API key uses separate bearer-token env setup.');
  assert.equal(existsSync(join(out, 'portable-skills', 'mcp.json')), false);
  assert.equal(existsSync(join(out, 'cursor', 'plugin.json')), false, 'Do not override native secret interpolation with a portable manifest.');
  const release = JSON.parse(readFileSync(join(out, 'release.json'), 'utf8'));
  assert.equal(release.cliSha256, createHash('sha256').update(readFileSync(join(out, 'action', 'bin/testsy.mjs'))).digest('hex'));
  for (const client of ['claude', 'codex']) assert.ok(existsSync(join(out, `${client}-marketplace`, 'plugins/testsy', 'skills', skillNames[0], 'SKILL.md')));
  assert.deepEqual(readdirSync(out).sort(), [...Object.keys(required), 'claude-marketplace', 'codex-marketplace', 'release.json'].sort());
});

test('build refuses destinations that could erase unrelated files', () => {
  assert.throws(() => build('/tmp'), /destination must/);
  assert.throws(() => build(root), /destination must/);
});

test('host generation updates every runtime address without embedding the caller environment', () => {
  const originalCli = readFileSync(join(root, 'bin/testsy.mjs'), 'utf8');
  const files = generatedFiles({app: 'https://app.fixture.invalid', landing: 'https://fixture.invalid', cli: originalCli,
    legacyAction: 'name: Old\ndescription: Old\nauthor: Old\n  url:\n    description: QA AI address.\n    default: https://old.invalid\n'});
  const config = JSON.parse(files.get('integrations/testsy/config.json'));
  assert.equal(config.app, 'https://app.fixture.invalid');
  for (const name of ['claude.mcp.json', 'cursor.mcp.json', 'oauth.mcp.json']) assert.equal(JSON.parse(files.get(`integrations/testsy/manifests/${name}`)).mcpServers.testsy.url, `${config.app}/mcp`);
  assert.equal(JSON.parse(files.get('integrations/testsy/manifests/gemini-extension.json')).mcpServers.testsy.httpUrl, `${config.app}/mcp`);
  assert.equal(JSON.parse(files.get('integrations/testsy/server.json')).remotes[0].url, `${config.app}/mcp`);
  assert.ok(files.get('integrations/testsy/action.yml').includes(`default: ${config.app}`));
  assert.ok(files.get('integrations/testsy/bin/testsy.mjs').includes(`process.env.TESTSY_AI_URL || '${config.app}'`));
  assert.ok(files.get('apps/customer/integrations/github-action/action.yml').includes(`default: ${config.app}`));
});

test('package integrity validates independently of any API key or model access', () => {
  const prior = process.env.TESTSY_AI_API_KEY;
  delete process.env.TESTSY_AI_API_KEY;
  try { assert.equal(validate().skills, 3); }
  finally { if (prior !== undefined) process.env.TESTSY_AI_API_KEY = prior; }
});

test('standalone export is an allowlisted package that builds without the private parent', () => {
  const marker = join(root, 'skills', skillNames[0], '.export-test-local-only.json');
  writeFileSync(marker, '{"localOnly":true}\n');
  try {
    const out = exportRelease(), inventory = JSON.parse(readFileSync(join(out, 'export.json'), 'utf8'));
    assert.deepEqual(inventory.targets, releaseTargets);
    assert.deepEqual(Object.keys(inventory.files).filter(name => name.startsWith('source/')).map(name => name.slice(7)).sort(), [...sourceFiles].sort());
    assert.ok(Object.keys(inventory.files).every(name => !name.includes('.export-test-local-only') && !/(?:^|\/)(?:\.env(?:\.|$)|cloud|artifacts|mobile|\.git)(?:\/|$)/.test(name)));
    for (const [name, hash] of Object.entries(inventory.files)) assert.equal(createHash('sha256').update(readFileSync(join(out, name))).digest('hex'), hash);
    assert.match(execFileSync(process.execPath, ['scripts/validate.mjs'], {cwd: join(out, 'source'), encoding: 'utf8'}), /Validated local integration package/);
    assert.match(execFileSync(process.execPath, ['scripts/build.mjs'], {cwd: join(out, 'source'), encoding: 'utf8'}), /Built/);
    assert.throws(() => exportRelease(root), /destination must/);
  } finally { rmSync(marker, {force: true}); }
});

test('portable gzip has exact platform-independent bytes, checksum and multiblock boundaries', () => {
  assert.equal(portableGzip(Buffer.from('abc')).toString('hex'), '1f8b08000000000000ff010300fcff616263c241243503000000');
  for (const size of [0, 1, 65534, 65535, 65536, 131070, 131071]) {
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i++) data[i] = i % 251;
    assert.deepEqual(gunzipSync(portableGzip(data)), data);
  }
});

test('download archives are deterministic and preserve a safe single repository root', () => {
  const out = exportRelease(), source = join(out, 'source');
  const first = archive(source, 'source'), second = archive(source, 'source');
  assert.deepEqual(first, second);
  const tar = gunzipSync(first), names = [];
  for (let offset = 0; tar[offset] !== 0; ) {
    const header = tar.subarray(offset, offset + 512), end = header.indexOf(0);
    names.push(header.toString('utf8', 0, end));
    assert.equal(parseInt(header.toString('ascii', 136, 147), 8), 0);
    const bytes = parseInt(header.toString('ascii', 124, 135), 8);
    offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  assert.deepEqual(names.sort(), sourceFiles.map(name => `testsy-source/${name}`).sort());
  assert.ok(names.every(name => !name.split('/').includes('..')));
});

test('skill zips are deterministic store-only archives that hold the skill folder', () => {
  const folder = join(root, 'skills/testsy-check-release');
  const first = skillZip(folder, 'testsy-check-release'), second = skillZip(folder, 'testsy-check-release');
  assert.ok(first.equals(second));
  assert.equal(first.readUInt32LE(0), 0x04034b50);
  const nameLength = first.readUInt16LE(26), size = first.readUInt32LE(18);
  assert.equal(first.subarray(30, 30 + nameLength).toString('utf8'), 'testsy-check-release/SKILL.md');
  assert.ok(first.subarray(30 + nameLength, 30 + nameLength + size).equals(readFileSync(join(folder, 'SKILL.md'))));
  assert.equal(first.readUInt32LE(first.length - 22), 0x06054b50);
});
