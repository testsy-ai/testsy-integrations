// Run the exact composite action shell against a local REST fixture, including its pinned CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const action = readFileSync(join(root, 'action.yml'), 'utf8');
const shell = action.slice(action.indexOf('      run: |\n') + '      run: |\n'.length).split('\n').map(line => line.startsWith('        ') ? line.slice(8) : line).join('\n');

async function fixture(status, failOn = 'failed,error', project = 'p_fixture', fingerprint = '', targetUrl = '') {
  const directory = mkdtempSync(join(tmpdir(), 'testsy-action-'));
  const junit = join(directory, 'result.xml'), calls = [], key = 'fixture-secret-value';
  const server = createServer((req, res) => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => handle(req, res, raw)); });
  const handle = (req, res, raw) => {
    calls.push({path: req.url, auth: req.headers.authorization, method: req.method, idempotency: req.headers['idempotency-key'], body: () => { try { return JSON.parse(raw); } catch { return null; } }});
    const url = new URL(req.url, 'http://fixture');
    const send = (code, body) => {res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(body));};
    if (req.headers.authorization !== `Bearer ${key}`) return send(401, {error: 'Missing fixture authentication'});
    if (req.method === 'GET' && url.pathname === '/api/v1/projects/p_fixture/builds/lookup') return send(200, url.searchParams.get('fingerprint') === 'fp-known-0001'
      ? {build: {id: 'ab_known', status: 'ready', platform: 'android', appId: 'com.example.app', fingerprint: 'fp-known-0001'}, matchedBy: 'fingerprint'} : {build: null, matchedBy: null});
    if (req.method === 'POST' && url.pathname === '/api/v1/projects/p_fixture/run') return send(201, {started: [{testId: 't_fixture', runId: 'j_fixture', mode: 'cold'}], skipped: []});
    if (req.method === 'GET' && url.pathname === '/api/v1/runs') return send(200, {runs: [{id: 'j_fixture', testId: 't_fixture', testTitle: 'Title persists', status, final: true,
      headline: status === 'passed' ? 'Title persisted after reload' : 'Expected new title; observed original title',
      link: 'https://fixture.invalid/runs/j_fixture', requirements: [{requirement: 'New title persists', outcome: status === 'passed' ? 'pass' : 'fail', reason: 'Synthetic fixture'}]}]});
    return send(404, {error: 'Unexpected fixture request'});
  };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise(resolve => execFile('bash', ['-c', shell], {timeout: 15000,
      env: {...process.env, QA_AI_API_KEY: key, QA_AI_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_ACTION_PATH: root,
        IN_PROJECT: project, IN_TESTS: '', IN_MODE: 'cold', IN_TIMEOUT: '5s', IN_FAIL_ON: failOn, IN_JUNIT: junit, IN_BUILD: '', IN_BUILD_LABEL: '', IN_FINGERPRINT: fingerprint, IN_TARGET_URL: targetUrl,
        GITHUB_STEP_SUMMARY: join(directory, 'summary.md'), GITHUB_OUTPUT: join(directory, 'output.txt')}}, (error, stdout, stderr) => resolve({code: error?.code ?? 0, stdout, stderr})));
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(key), 'Never log the API key.');
    return {...result, calls, report: existsSync(junit) ? readFileSync(junit, 'utf8') : '', output: existsSync(join(directory, 'output.txt')) ? readFileSync(join(directory, 'output.txt'), 'utf8') : ''};
  } finally {await new Promise(resolve => server.close(resolve)); rmSync(directory, {recursive: true, force: true});}
}

test('pinned action passes a successful run and emits evidence link in JUnit', async () => {
  const result = await fixture('passed');
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.calls[0].idempotency, 'Run start must carry an idempotency key.');
  assert.ok(result.calls.every(call => call.auth === 'Bearer fixture-secret-value'));
  assert.match(result.report, /failures="0"/); assert.match(result.report, /https:\/\/fixture.invalid\/runs\/j_fixture/);
});

test('pinned action preserves a demonstrated mismatch as a failure', async () => {
  const result = await fixture('failed');
  assert.equal(result.code, 1); assert.match(result.report, /failures="1"/); assert.match(result.report, /observed original title/);
});

test('strict release gate refuses a blocked result', async () => {
  const result = await fixture('blocked', 'failed,error,blocked,inconclusive,cancelled');
  assert.equal(result.code, 1); assert.match(result.report, /errors="1"/);
});

test('fingerprint alone is a lookup: build-needed/build-id outputs, no run started, exit 0 whether or not the build exists', async () => {
  const known = await fixture('passed', 'failed,error', 'p_fixture', 'fp-known-0001');
  assert.equal(known.code, 0, known.stderr); assert.match(known.output, /build-id=ab_known\nbuild-needed=false\n/); assert.match(known.stdout, /ab_known/);
  assert.ok(known.calls.every(call => call.method === 'GET' && call.path.includes('/builds/lookup?')), 'nothing but the lookup is called');
  assert.equal(known.report, '', 'no JUnit report: nothing ran');
  const missing = await fixture('passed', 'failed,error', 'p_fixture', 'fp-new-0002');
  assert.equal(missing.code, 0, missing.stderr); assert.match(missing.output, /build-id=\nbuild-needed=true\n/); assert.match(missing.stderr, /no build found/);
  assert.equal(missing.calls.length, 1);
});

test('fingerprint with no project is a usage error, not a silent run', async () => {
  const result = await fixture('passed', 'failed,error', '', 'fp-known-0001');
  assert.equal(result.code, 2); assert.equal(result.calls.length, 0);
});

test('target-url makes website tests start at the deployment address', async () => {
  const result = await fixture('passed', 'failed,error', 'p_fixture', '', 'https://pr-3.preview.example.test');
  assert.equal(result.code, 0, result.stderr);
  const start = result.calls.find(c => c.path === '/api/v1/projects/p_fixture/run');
  assert.equal(start.body()?.url, 'https://pr-3.preview.example.test');
});
