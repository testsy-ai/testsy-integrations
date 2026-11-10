# Testsy integrations

Turn release checks into saved plain-English tests, inspect failed runs, and keep regression coverage after a fix. These packages connect coding agents to your Testsy workspace through the hosted MCP endpoint.

The three shared skills are **testsy-check-release**, **testsy-investigate-run**, and **testsy-regression-from-bug**. See [example requests](examples/prompts.md). All skills preserve expected behavior and distinguish app failures from blocked, inconclusive and execution-error outcomes.

This directory is the standalone, MIT-licensed integration package. Its license covers these integration files only; it does not license the Testsy service or the parent repository.

## Published repositories (2026-10-24)

| Root | Repository | Install |
| --- | --- | --- |
| source | https://github.com/testsy-ai/testsy-integrations | canonical `skills/`, manifests, CLI copy, action |
| claude-marketplace | https://github.com/testsy-ai/testsy-claude-plugins | `/plugin marketplace add testsy-ai/testsy-claude-plugins` |
| cursor | https://github.com/testsy-ai/testsy-cursor | directory submission pending |
| gemini | https://github.com/testsy-ai/testsy-gemini-extension | `gemini extensions install https://github.com/testsy-ai/testsy-gemini-extension` |
| action | https://github.com/testsy-ai/testsy-action | `uses: testsy-ai/testsy-action@v1` |
| registry | MCP Registry `dev.testsy/testsy` 1.0.0 | published with DNS proof on testsy.dev (`scripts/ops/mcp-registry-publish.sh`) |

`scripts/ops/integration-publish.sh <root> <repo> "<description>" [tag]` republishes a root after `npm run export`.

## Build and check

Node.js 22 or later is required; no dependencies or API calls are needed:

```sh
npm run check
npm run build
npm run export
npm run archives
```

Run these commands inside `integrations/testsy` in the parent repository. In a standalone checkout, run them at the repository root. `dist/` contains independent client packages, two local marketplace catalogs, the pinned GitHub Action and MCP Registry metadata. Every package is assembled from the same `skills/` source; generated manifests do not embed credentials. The checks establish local packaging and mock-API behavior. They do not establish live-client compatibility, marketplace approval or successful hosted runs. See [release requirements](RELEASING.md).

`npm run export` prepares independent repository roots in `release/`, using an explicit file allowlist for the standalone source package. It never copies the parent checkout or its Git history, initializes Git or publishes anything. `release/export.json` inventories every exported file by SHA-256. `npm run archives` prepares deterministic `testsy-<target>.tar.gz` archives in `release/archives/`, with `SHA256SUMS` and `release.json`. Each archive extracts into one `testsy-<target>/` directory. Review and copy only the chosen repository root when publishing; never run publication commands from the private parent checkout.

From the parent Testsy application checkout, `npm run downloads` writes the same archives and checksum metadata to the landing site's fixed `apps/landing/public/downloads/testsy/` directory for its next deployment. Download publication does not create a marketplace listing. A downloaded source package supports the build commands above; a native client package is already assembled and uses its own README for installation.
Run `npm run downloads:check` in the parent checkout to verify that the checked-in public archives still match the current package; it does not alter the public assets.

Before building in the parent repository, refresh shared configuration with `npx tsx scripts/ops/config-gen.ts` from its root. Edit `shared/hosts.ts` for addresses and `apps/customer/public/cli/qa-ai.mjs` for the canonical CLI. The generator copies those into this package. In an exported standalone checkout, generated files are checked-in release inputs.

## Connect your workspace

Create a workspace API key in Testsy Settings → API keys, with the run and edit permissions needed for your workflow. Keep it in a secret manager, client settings or `QA_AI_API_KEY` environment variable. Never paste it into a prompt, screenshot or committed config. Read-only investigation needs only read access. Runs use your workspace allowance and may perform the actions described in the test.

The current endpoint and native configuration are in [config.json](config.json) and `manifests/`. API keys remain supported independently of OAuth directory connections.

### Codex

After building, add the local catalog with `codex plugin marketplace add ./dist/codex-marketplace`, then install Testsy from that marketplace in your supported Codex client. For the downloaded catalog, extract `testsy-codex-marketplace.tar.gz` and use `./testsy-codex-marketplace` in that command. Configure the MCP connection separately so Codex reads the bearer token from the environment rather than storing a literal key in the plugin:

```sh
codex mcp add testsy --url "$(node -p "require('./config.json').app + '/mcp'")" --bearer-token-env-var QA_AI_API_KEY
```

Set `QA_AI_API_KEY` securely in the environment of the client, restart it, and check its MCP and skill lists. The Codex package contains skills only; the command above supplies its API-key connection. CLI/server names can be namespaced by the host.

### Claude Code

Set `QA_AI_API_KEY` securely in the environment, then load the package for a local session:

```sh
claude --plugin-dir ./dist/claude
```

Published marketplace: `/plugin marketplace add testsy-ai/testsy-claude-plugins`, then `/plugin install testsy@testsy` (verified in a clean Claude Code profile, 2026-10-24). For a local build instead, run `/plugin marketplace add /absolute/path/to/dist/claude-marketplace` and `/plugin install testsy@testsy` in Claude Code. Restart the session afterwards.

### Cursor

The package in `dist/cursor` contains a native Cursor manifest declaring the `QA_AI_API_KEY` variable and its HTTP MCP config. It is prepared for repository submission or a team-managed plugin import; set the variable through Plugins → Configure. It is not already listed in Cursor's public marketplace.

For direct use before a listing is approved, copy the three skill folders into your project's `.cursor/skills/`, and merge the `mcpServers` entry from `manifests/cursor.mcp.json` into your MCP configuration using Cursor's supported secret/environment mechanism. Do not overwrite existing project configuration. Verify tool discovery in Cursor before running a test.

### Gemini CLI

```sh
gemini extensions install ./dist/gemini
```

Supply the API key in the sensitive Testsy API key setting when prompted. Restart Gemini CLI, then inspect its MCP and skill lists. The manifest declares the environment variable explicitly because Gemini extensions sanitize inherited environment variables.

### ChatGPT and portable plugin hosts

`dist/portable-skills` is a skills-only Agent Plugins v1 package. It needs a separate Testsy connection capable of supplying the tools. `dist/openai-oauth-candidate` also contains the remote MCP endpoint for OAuth discovery. Treat it as a release candidate until authorization, workspace isolation, refresh and revocation pass against the deployed service, followed by clean-install testing and directory review.

Portable Agent Plugins v1 HTTP headers are literal; `${QA_AI_API_KEY}` in a portable `mcp.json` would be sent literally. This package therefore uses native client secret mechanisms for direct API-key installs, and never claims portable API-key interpolation.

### skills.sh and other Agent Skills hosts

The source `skills/` directory uses standard `SKILL.md` files. Copy the selected skill folders into the supported skill directory of your client and connect Testsy MCP separately. Publish an exported, reviewed repository before advertising a repository-based skills install command. There is no public repository or marketplace listing implied by this source package.

## CI and command line

The versioned CLI is bundled as `bin/testsy.mjs` and the action in `action.yml` executes that pinned copy. It does not fetch executable code from a mutable website at run time. The CLI supports the existing `QA_AI_*` environment variables for compatibility.

```sh
node bin/testsy.mjs version
node bin/testsy.mjs projects
node bin/testsy.mjs run --project p_myproject --junit testsy-junit.xml
```

Exit codes: `0` satisfies the configured gate, `1` a selected failure status, `2` usage/API/run-start failure, `3` polling timeout. The default gate fails on `failed,error`; use `--fail-on failed,error,blocked,inconclusive,cancelled` when a release requires conclusive completion of every selected test.

After copying the built action into `.github/actions/testsy` of your application repository:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '22'
  - uses: ./.github/actions/testsy
    with:
      api-key: ${{ secrets.TESTSY_API_KEY }}
      project: p_myproject
      fail-on: failed,error,blocked,inconclusive,cancelled
  - uses: actions/upload-artifact@v4
    if: always()
    with:
      name: testsy-results
      path: testsy-junit.xml
```

Published as [testsy-ai/testsy-action](https://github.com/testsy-ai/testsy-action) (`uses: testsy-ai/testsy-action@v1`, release v1.0.0; verified on real GitHub Actions in the private sandbox, 2026-10-24). Pin a commit SHA in production workflows. Pin that commit SHA in production workflows. Mobile build inputs accept APKs and zipped iOS Simulator apps; check current runner availability before relying on app execution.

## Registry and publication

[server.json](server.json) describes the existing remote MCP server, with a secret Authorization header. The `dev.testsy/testsy` namespace requires domain ownership authentication. Publication, public repository creation and directory review are separate external steps; see [RELEASING.md](RELEASING.md).

Official format references checked on 2026-10-21: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Agent Plugins specification](https://agent-plugins.org/specification), [Claude plugin manifest](https://code.claude.com/docs/en/plugins-reference), [Claude marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [Cursor plugins](https://cursor.com/docs/reference/plugins), [Gemini extensions](https://geminicli.com/docs/extensions/reference/), [MCP Registry remote servers](https://modelcontextprotocol.io/registry/remote-servers).
