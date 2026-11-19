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
  const intro = `# Testsy\n\nCheck releases, investigate failed runs and preserve regression coverage.\n\nDocumentation: ${landing}/docs/mcp/\n\n`;
  const endings = '\n\nThis is an integration package prepared for local testing. A directory listing or live-client validation is not implied. Keep API keys out of prompts and version control. Runs use the workspace allowance and perform the test\'s actions. MIT applies to these integration files only.\n';
  const body = {
    codex: `This skills plugin requires a separate Testsy MCP connection. Add this plugin to a supported local Codex marketplace, then configure the connection:\n\n\`\`\`sh\ncodex mcp add testsy --url ${app}/mcp --bearer-token-env-var TESTSY_AI_API_KEY\n\`\`\`\n\nSet TESTSY_AI_API_KEY securely in the client environment. Restart the client and inspect its skill/MCP lists.`,
    claude: `Install it in Claude Code:\n\n\`\`\`text\n/plugin marketplace add ${repos['claude-marketplace'] ? repos['claude-marketplace'].replace('https://github.com/', '') : '<owner>/<repo>'}\n/plugin install testsy@testsy\n\`\`\`\n\n` + 'Set TESTSY_AI_API_KEY securely in the environment first. To load a local copy instead, run `claude --plugin-dir /absolute/path/to/this/folder`. The bundled .mcp.json supplies the remote HTTP server. Restart the session and inspect /mcp and /skills.',
    cursor: 'Import or submit this native Cursor plugin using your supported Plugins workflow. Configure TESTSY_AI_API_KEY in Plugins → Configure. The manifest declares the variable; mcp.json references it. Before marketplace approval you can copy the skill folders into .cursor/skills/ and merge the MCP entry into your existing client configuration using its supported secret mechanism.',
    gemini: `Install with \`gemini extensions install ${geminiRepo ?? '/absolute/path/to/this/folder'}\`. Supply the sensitive Testsy API key setting when prompted. Restart the CLI and inspect its MCP and skill lists.`,
    'portable-skills': 'This Agent Plugins v1 package contains skills only. Connect Testsy MCP separately through the host\'s supported authentication mechanism before invoking a skill. Do not expect a portable HTTP header to expand an arbitrary environment variable.',
    'openai-oauth-candidate': 'This Agent Plugins v1 package includes skills and a remote MCP endpoint for OAuth discovery. It is a candidate, not a verified directory release. Prove deployed OAuth discovery, PKCE, workspace consent, refresh/revocation and isolation in a clean client before submitting it. See RELEASING.md.',
    action: `This action bundles its versioned Node CLI. Use Node 22 or later. Configure \`api-key\` as a repository secret and either \`project\` or \`tests\`. Use it as \`uses: ${actionRef ?? '<owner>/testsy-action'}@v1\` (pin a commit SHA in production), or copy this folder to .github/actions/testsy and use \`./.github/actions/testsy\` after checkout. \`junit\` defaults to testsy-junit.xml. For a conclusive release gate set \`fail-on: failed,error,blocked,inconclusive,cancelled\`.\n\nCLI: \`node bin/testsy.mjs version\`, then \`node bin/testsy.mjs run --project p_yourproject --junit testsy-junit.xml\` with TESTSY_AI_API_KEY securely set.`,
  }[client];
  return intro + body + endings;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`Built ${build()}`);
