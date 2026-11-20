#!/usr/bin/env node
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validate, skillNames} from './validate.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));
export function build(destination = join(root, 'dist')) {
  const out = resolve(destination);
  // Do not let a typo delete the source tree or an arbitrary external directory.
  if (out !== join(root, 'dist')) throw new Error('Build destination must be the package dist directory.');
  validate();
  rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
  const emit = (folder, source, target = source) => { const to = join(out, folder, target); mkdirSync(dirname(to), {recursive: true}); cpSync(join(root, source), to, {recursive: true}); };
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  const shared = folder => {
    for (const name of skillNames) emit(folder, `skills/${name}/SKILL.md`);
    for (const f of ['LICENSE', 'RELEASING.md', 'examples/prompts.md']) emit(folder, f);
    writeFileSync(join(out, folder, 'README.md'), installReadme(folder, config));
  };
  for (const f of ['codex', 'claude', 'cursor', 'gemini', 'portable-skills', 'openai-oauth-candidate']) shared(f);
  emit('codex', 'manifests/codex.plugin.json', '.codex-plugin/plugin.json');
  emit('claude', 'manifests/claude.plugin.json', '.claude-plugin/plugin.json');
  emit('claude', 'manifests/claude.mcp.json', '.mcp.json');
  emit('claude', 'assets/logo.png', '.claude-plugin/icon.png');   // the Claude directory's listing icon (square PNG, 512 px)
  emit('cursor', 'manifests/cursor.plugin.json', '.cursor-plugin/plugin.json');
  emit('cursor', 'manifests/cursor.mcp.json', 'mcp.json');
  emit('gemini', 'manifests/gemini-extension.json', 'gemini-extension.json');
  for (const f of ['portable-skills', 'openai-oauth-candidate']) emit(f, 'manifests/portable.plugin.json', 'plugin.json');
  emit('openai-oauth-candidate', 'manifests/oauth.mcp.json', 'mcp.json');
  for (const f of ['codex', 'portable-skills', 'openai-oauth-candidate']) emit(f, 'assets/logo.png');   // the manifests' logo and composerIcon
  for (const f of ['LICENSE', 'action.yml', 'bin/testsy.mjs']) emit('action', f);
  writeFileSync(join(out, 'action', 'README.md'), installReadme('action', config));
  emit('registry', 'server.json'); emit('registry', 'LICENSE'); emit('registry', 'RELEASING.md'); emit('registry', 'examples/prompts.md');
  // Self-contained local catalogs; publish these directories as dedicated repos only after client checks.
  for (const client of ['claude', 'codex']) {
    const folder = `${client}-marketplace`, sub = `plugins/testsy`, catalogDir = client === 'claude' ? '.claude-plugin' : '.agents/plugins';
    cpSync(join(out, client), join(out, folder, sub), {recursive: true});
    const entry = client === 'claude' ? {name: 'testsy', source: './plugins/testsy'}
      : {name: 'testsy', source: {source: 'local', path: './plugins/testsy'}, policy: {installation: 'AVAILABLE', authentication: 'ON_INSTALL'}, category: 'Developer Tools'};
    const catalog = {name: 'testsy', ...(client === 'claude' ? {owner: {name: 'Testsy'}, description: 'Testsy QA workflows and workspace connection.'} : {interface: {displayName: 'Testsy'}}), plugins: [entry]};
    mkdirSync(join(out, folder, catalogDir), {recursive: true});
    writeFileSync(join(out, folder, catalogDir, 'marketplace.json'), JSON.stringify(catalog, null, 2) + '\n');
    emit(folder, 'LICENSE');
    const repo = client === 'claude' && config.repos?.['claude-marketplace'] ? config.repos['claude-marketplace'].replace('https://github.com/', '') : null;
    const install = client === 'claude' ? `/plugin marketplace add ${repo ?? '/absolute/path/to/this/folder'}\n/plugin install testsy@testsy`
      : 'codex plugin marketplace add /absolute/path/to/this/folder';
    writeFileSync(join(out, folder, 'README.md'), `# Testsy local marketplace\n\nRegister this folder in ${client}:\n\n\`\`\`text\n${install}\n\`\`\`\n\nThen follow plugins/testsy/README.md to configure the workspace connection. This local catalog is not a public directory approval.\n`);
  }
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  writeFileSync(join(out, 'release.json'), JSON.stringify({version, cliSha256: createHash('sha256').update(readFileSync(join(root, 'bin/testsy.mjs'))).digest('hex'),
    validation: 'Local package and mock-API checks only. No marketplace approval or live-client proof implied.'}, null, 2) + '\n');
  return out;
}

function installReadme(client, {app, landing, repos = {}}) {
  const actionRef = repos.action ? repos.action.replace('https://github.com/', '') : null;
  const geminiRepo = repos.gemini ?? null;
  const intro = `# Testsy\n\nTestsy runs QA tests written in plain English on websites and on iOS and Android apps, and returns a verdict for every check with its evidence: a replay, video, the values it saw, console and network.\n\nDocumentation: ${landing}/docs/mcp/ · Sign up: ${app}\n\n`;
  const endings = '\n\nKeep API keys in your secret store, out of prompts and version control. A run uses the workspace allowance and performs real actions on the site or app it is pointed at, so use it on apps and accounts you are allowed to test. These integration files are MIT licensed.\n';
  const body = {
    codex: `This Codex plugin adds three skills: check a release, investigate a failed run, and turn a fixed bug into a saved regression test. The skills use the Testsy MCP connection, which you add once:\n\n\`\`\`sh\ncodex mcp add testsy --url ${app}/mcp --bearer-token-env-var TESTSY_AI_API_KEY\n\`\`\`\n\nSet TESTSY_AI_API_KEY (a workspace API key from ${app}) in the environment Codex runs in, then restart Codex.\n\nCodex asks before it starts a run or changes a test. For unattended use (codex exec with approvals off), add default_tools_approval_mode = "approve" under [mcp_servers.testsy] in ~/.codex/config.toml.`,
    claude: `Install it in Claude Code:\n\n\`\`\`text\n/plugin marketplace add ${repos['claude-marketplace'] ? repos['claude-marketplace'].replace('https://github.com/', '') : '<owner>/<repo>'}\n/plugin install testsy@testsy\n\`\`\`\n\nIn the Claude desktop app, add the same repository as a marketplace under Customize, then install Testsy from it. The plugin brings the three skills and the Testsy connection (${app}/mcp). There is no key to set: the first time Claude calls a Testsy tool you sign in in the browser and choose the workspace (in Claude Code, /mcp shows the connection and its sign-in). For CI or another headless session, add the connection with a workspace API key instead (replace YOUR_API_KEY; the plugin itself reads no key):\n\n\`\`\`sh\nclaude mcp add --transport http testsy ${app}/mcp --header "Authorization: Bearer YOUR_API_KEY"\n\`\`\`\n\nTo load a local copy, run \`claude --plugin-dir /absolute/path/to/this/folder\`.`,
    cursor: `This Cursor plugin adds the Testsy MCP server and three skills: check a release, investigate a failed run, and turn a fixed bug into a saved regression test.\n\nInstall it from the Cursor plugin directory, or add this repository as a plugin. Then set TESTSY_AI_API_KEY (a workspace API key from ${app}) under Plugins → Configure. To use it without the plugin, copy the skill folders into .cursor/skills/ and add the MCP entry from mcp.json to your Cursor MCP settings.`,
    gemini: `This Gemini CLI extension adds the Testsy MCP server and three skills: check a release, investigate a failed run, and turn a fixed bug into a saved regression test.\n\nInstall with \`gemini extensions install ${geminiRepo ?? '/absolute/path/to/this/folder'}\`. Enter a Testsy workspace API key (from ${app}) when prompted; it is stored as a sensitive setting. Restart the CLI and check its MCP and skill lists.`,
    'portable-skills': 'This Agent Plugins v1 package contains skills only. Connect Testsy MCP separately through the host\'s supported authentication mechanism before invoking a skill. Do not expect a portable HTTP header to expand an arbitrary environment variable.',
    'openai-oauth-candidate': `This plugin for ChatGPT and Codex adds the Testsy MCP server (${app}/mcp) and three skills: check a release, investigate a failed run, and turn a fixed bug into a saved regression test. There is no key to set: the first time a Testsy tool is used you sign in to Testsy in the browser and choose the workspace.`,
    action: `## Use it in a workflow\n\n\`\`\`yaml\n- uses: ${actionRef ?? '<owner>/testsy-action'}@v1\n  with:\n    api-key: \${{ secrets.TESTSY_AI_API_KEY }}\n    project: p_yourproject\n\`\`\`\n\nThe step starts the project's saved tests, waits for them and fails the job when a test fails. Each test prints its verdict with a link to the run and a watch link that opens without signing in. A JUnit report is written to \`testsy-junit.xml\`.\n\n- \`api-key\` (required): a workspace API key from ${app}, stored as a repository secret.\n- \`project\` or \`tests\`: a project id, or a comma-separated list of saved test ids.\n- \`target-url\`: start website tests at a preview or staging deploy of the same site.\n- \`build\`: an APK or zipped iOS Simulator app (a path, an https link or a build id) for app tests.\n- \`fail-on\`: which results fail the job; for a strict release gate use \`failed,error,blocked,inconclusive,cancelled\`.\n\nAll inputs are in action.yml. Pin a commit SHA in production. The action bundles its own Node CLI (Node 22 or later, present on GitHub-hosted runners); the same CLI runs anywhere: \`node bin/testsy.mjs run --project p_yourproject --junit testsy-junit.xml\` with TESTSY_AI_API_KEY set.`,
  }[client];
  return intro + body + endings;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`Built ${build()}`);
