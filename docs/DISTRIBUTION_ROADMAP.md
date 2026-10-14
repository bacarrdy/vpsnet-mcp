# Distribution roadmap

Reviewed **2026-10-14** against official provider documentation and public listing evidence.
This is a publication plan, not a claim that VPSnet is listed or live-tested on every client.
The structured inventory is [distribution/targets.json](../distribution/targets.json).

The reviewed source baseline is `7403683`, with plugin source version `0.6.9`.
The [published artifact feed](../distribution/releases/published.json) independently
records plugin `0.6.9` and npm MCP `2.3.14`; later source changes are not those
already published ZIP bytes. The official MCP Registry still exposes **active
`com.vpsnet/vpsnet@0.6.7`**, so its next authorized update must preserve that name
and use the next approved immutable version. Publication in one registry never
establishes approval in another AI application's directory.

All hosted routes use `https://mcp.vpsnet.com/mcp`, Streamable HTTP and customer
OAuth. Customers select services and requested permissions. The directory
profile excludes purchases, billing and account API-key management. Underlying
VPSnet services retain their own prices. Functions execution, including failed
runs, consumes metered usage only with separate execution consent, a daily
ceiling and per-call acknowledgment. See [scope/cost details](REMOTE_MCP.md),
[listing metadata](../distribution/catalogs/metadata.json) and the packaged review
cases; do not replace this disclosure with a blanket “free” or “no charges” claim.

## Order of work

1. Update the **existing** official registry record after the reviewed release;
   verify exact version, latest pointer and payload. Resolve existing Glama and
   Smithery ownership before creating duplicates.
2. Prepare the native review intakes for OpenAI, Claude, Cursor, Langdock, Dust,
   Kimi Work and eligible catalogs. Each still needs its own actual client test,
   reviewer access and provider acceptance.
3. Offer documented direct-source installs and private OAuth connections now
   with their eligibility limits and explicit update instructions.
4. Treat MiniMax authenticated App onboarding as a prerequisite. Microsoft 365,
   Poe and Dify Marketplace require their own native package/adapter work;
   the portable plugin ZIP is not a submission-ready substitute.
5. Keep uncertain or restricted routes visible, with their next verification
   step. “Unknown” means no route was established by this review, not that a
   vendor can never support it.

## Public records already observed

Only the following provider records were established. A record's existence is
different from VPSnet publisher control, authenticated compatibility or review
approval of the current source.

| Record | Observed fact | Next step |
| --- | --- | --- |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/com.vpsnet%2Fvpsnet/versions/latest) | Active version 0.6.7; published/source plugin 0.6.9 is ahead | Update same name after approved release; verify exact payload |
| [Glama](https://glama.ai/mcp/connectors/com.vpsnet/vpsnet) | Feed-imported connector with OAuth indicators and incomplete/Unhealthy health check | Claim ownership and provide isolated scanner profile; the badge does not prove a runtime outage |
| [Smithery](https://smithery.ai/servers/jonas-eqlv/vpsnet) | Existing deployed public record; publisher ownership and proxy behavior unverified | Verify control/routing before update or duplicate submission |
| [mcpservers.org](https://mcpservers.org/servers/bacarrdy/vpsnet-mcp) | Exact provider listing found through current indexed evidence; direct fetch 403 | Verify current owner/edit flow; acceptance of a new submission is not claimed |

GitHub MCP search returned no VPSnet record. Checked Docker source and the named
awesome-list READMEs had no VPSnet entry. PulseMCP lookup was blocked, and Cursor
Directory community lookup was rate limited, so those remain unknown.

## Routes by surface

“Submission/review” identifies an intake, not an accepted listing. “Direct source
install” means a user can add a documented source; it does not mean a curated
catalog accepted it. “Private connection” covers user, workspace and self-hosted
configuration. All authenticated compatibility remains subject to actual tests.
Each source below is linked to the official process; detailed constraints and
secondary sources are in the structured inventory.

### AI clients

| Surface | Route | Concrete intake / remaining gate |
| --- | --- | --- |
| [OpenAI ChatGPT plugin directory](https://developers.openai.com/plugins/deploy/submission) | Submission/review | Upload reviewed portable ZIP at https://platform.openai.com/plugins; complete validation and review. Publisher access, domain challenge, isolated reviewer access, actual OAuth/demo and portal approval. [Packet/guide](../distribution/clients/openai/README.md). |
| [ChatGPT custom remote MCP](https://developers.openai.com/plugins/deploy/connect-chatgpt) | Private connection | User adds custom MCP; this does not publish to the public directory. Account/workspace eligibility and actual native sign-in. [Packet/guide](../distribution/clients/openai/README.md). |
| [Codex CLI / native source plugins](https://learn.chatgpt.com/docs/cli/reference) | Direct source install | Add the repository marketplace and install the plugin using native controls. Validate actual installation; self-added marketplace is separate from curated approval. [Packet/guide](../distribution/clients/openai/README.md). |
| [ChatGPT Work / desktop workspace plugins](https://learn.chatgpt.com/docs/enterprise/plugin-management) | Private connection | Admin imports plugin source into the workspace; follow documented app availability. Workspace administration and supported product surface; not consumer directory publication. [Packet/guide](../distribution/clients/openai/README.md). |
| [Claude / Cowork connector and plugin directory](https://claude.com/docs/plugins/submit) | Submission/review | Submit connector and GitHub plugin bundle at https://claude.ai/directory/manage. Publisher access, actual OAuth/reviewer account and separate directory approval. [Packet/guide](../docs/DIRECTORY_READINESS.md). |
| [Claude Code native marketplace](https://code.claude.com/docs/en/discover-plugins) | Direct source install | Add VPSnet Git marketplace and install vpsnet@vpsnet. Actual native OAuth test; source marketplace install is not directory approval. [Packet/guide](../docs/UPDATES.md). |
| [Grok custom connectors](https://docs.x.ai/grok/connectors) | Private connection | Add custom MCP at https://grok.com/connectors; real account OAuth still needs testing. No public self-service vendor intake or native ZIP update contract established. |
| [Gemini browser / mobile](https://support.google.com/gemini/answer/17209137) | Private connection | Eligible user adds custom Connected App; no public self-service directory intake verified. Currently US, personal account, age 18+, English and Keep Activity; web setup first. [Packet/guide](../docs/CLIENTS.md). |
| [Gemini CLI](https://geminicli.com/docs/extensions/reference/) | Direct source install | Public repo root manifest plus gemini-cli-extension topic supports gallery discovery. Actual native sign-in and gallery crawl; source skills now mirrored, but unreleased changes are not old published ZIP bytes. [Packet/guide](../distribution/clients/gemini-cli/README.md). |
| [Cursor IDE / Agent marketplace](https://cursor.com/docs/reference/plugins) | Submission/review | Native plugin publication at https://cursor.com/marketplace/publish. Actual OAuth, publisher review and acceptance. [Packet/guide](../distribution/clients/cursor/README.md). |
| [Kiro Power / standalone MCP](https://kiro.dev/docs/powers/create/) | Submission/review | Power submission at https://kiro.dev/powers/submit/; standalone custom MCP is separate. Power OAuth requested-scope behavior must pass real client test before submission. [Packet/guide](../distribution/clients/kiro/README.md). |
| [VS Code / GitHub Copilot](https://code.visualstudio.com/docs/agent-customization/agent-plugins) | Private connection | Add remote server using MCP: Add Server; registry listing handled separately. Native sign-in, organization policy and client tool approvals. [Packet/guide](../docs/CLIENTS.md). |
| [Windsurf / Devin Desktop and Local](https://docs.devin.ai/desktop/cascade/mcp) | Direct source install | Current Devin Local supports native plugin sources; legacy Cascade uses its own MCP setup. Select actual agent/version; do not reuse old filenames across agents. [Packet/guide](../docs/CLIENTS.md). |
| [Roo Code](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/) | Blocked/limited | Local MCP setup documented; hosted customer OAuth not established. Verify native OAuth or separately review a consent-preserving bridge. [Packet/guide](../docs/CLIENTS.md). |
| [Cline native MCP / curated marketplace](https://docs.cline.bot/mcp/mcp-overview) | Submission/review | Current curated marketplace README accepts registry entry PRs; use current schema. Actual install/OAuth and curator approval; older issue packet needs reconciliation with current PR flow. [Packet/guide](../distribution/catalogs/cline/issue.md). |
| [Mistral Vibe Work / Studio](https://docs.mistral.ai/vibe/work/connectors/mcp-connectors) | Private connection | Admin adds custom remote connector. Directory terms exist but exact public submission intake is unverified. Actual OAuth, mutation approval and provider inquiry for public directory. [Packet/guide](../docs/CLIENTS.md). |
| [Mistral Vibe Code CLI](https://docs.mistral.ai/vibe/code/cli/mcp-servers) | Blocked/limited | No native hosted VPSnet OAuth path under current documented limitation. OAuth MCP explicitly unsupported; do not bypass using shared customer credentials. [Packet/guide](../docs/CLIENTS.md). |
| [Perplexity custom connectors / Skills](https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors) | Private connection | Custom Remote connector is documented; public Skills Marketplace does not prove MCP provider submission. Pro/Max/Enterprise eligibility and organization policy; real OAuth test. [Packet/guide](../docs/CLIENTS.md). |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/) | Direct source install | Public Git/archive/npm or compatible marketplace install, including Agent Plugins v1. Actual OAuth test; no implication of Qwen browser listing. [Packet/guide](../docs/CLIENTS.md). |
| [Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html) | Direct source install | Custom source install; Curated partners enrollment is separate from Kimi Work marketplace. Native login and unknown partner catalog intake. [Packet/guide](../distribution/clients/kimi-code/README.md). |

### Additional consumer and Asian platforms

| Surface | Route | Concrete intake / remaining gate |
| --- | --- | --- |
| [Microsoft Copilot consumer (copilot.com/mobile)](https://support.microsoft.com/en-us/microsoft-copilot/connecting-microsoft-copilot-to-other-services) | Unknown intake | No open VPSnet vendor submission process identified. Absence from reviewed docs does not prove technical impossibility or a permanently closed partner program. |
| [Microsoft 365 Copilot / Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent) | New adapter/package | Package and validate; use Partner Center Microsoft 365 and Copilot offer, submit for certification, then publish after approval. Native package schema, end-to-end VPSnet OAuth and eligible public tool surface need implementation/validation. |
| [Poe public server/API bots](https://creator.poe.com/docs/server-bots/quick-start) | New adapter/package | Create Bot → Server bot, configure endpoint/access key and public visibility; API createBot is another documented create/update route. Per-user VPSnet account linking, token isolation, consent and action confirmation need a separate design. |
| [You.com consumer assistants / developer MCP](https://you.com/docs/integrations) | Unknown intake | No reviewed official public process for adding VPSnet tools to You.com consumer chat. Arbitrary inbound MCP, third-party consumer catalog and update controls remain unknown. |
| [Manus custom MCP connectors / Projects](https://www.manus.im/features/connectors) | Private connection | User Create → Add MCP by URL is concrete private setup. Project publication is not evidence of a public vendor connector catalog. Self-service public vendor connector intake and propagation of user authorization through shared Projects are not established. |
| [Manus Open Apps partner program](https://open.manus.im/docs/v2/open-app) | Unknown intake | Standard clients serve their team; trusted_public enrollment requires the documented partner contact. This is not a documented public submission path for a VPSnet MCP connector in Manus. |
| [Genspark custom connectors and Custom Agent Store](https://www.genspark.ai/helpcenter/connectors-and-integrations) | Submission/review | Create/test agent → Configure → Share → Custom Agent Store. Public native connector catalog intake is not documented. An agent shared to the store is not proof its custom MCP travels with it or each user receives a safe separate OAuth flow. |
| [DeepSeek consumer chat vs developer/model integrations](https://api-docs.deepseek.com/quick_start/agent_integrations/github_copilot/) | Unknown intake | No verified public DeepSeek-browser plugin/MCP marketplace intake. Consumer arbitrary-MCP support and publication remain unknown. A tool-calls page fetch timed out; no unsupported API claim is inferred from it. |
| [Z.ai/GLM developer API vs consumer chat](https://docs.z.ai/guides/capabilities/mcp-call) | New adapter/package | No consumer-chat public VPSnet plugin submission path verified. OAuth discovery/refresh automation for this API path and consumer store eligibility remain unknown. |
| [ZCode native plugins / MCP](https://zcode.z.ai/en/docs/mcp-services) | Direct source install | Settings → Plugins → Create → Add marketplace accepts repository/Git/local source. Public catalog is curated; no self-submit procedure established. No promise of automatic updates; public curation intake and actual VPSnet live OAuth need validation. |
| [Kimi Work official plugin marketplace](https://www.kimi.com/en/help/plugins-and-skills/create) | Submission/review | Personal plugin detail → envelope feedback → Apply for official marketplace publication → provide email; human review follows. Kimi Work marketplace approval is distinct from Kimi Code Curated partners; no claim of VPSnet listing. [Packet/guide](../distribution/clients/kimi-code/README.md). |
| [MiniMax Code desktop / MiniMax Agent cloud, CN/US](https://agent.minimax.io/docs/code/agents/plugin-submission) | Submission/review | Official Plugin Marketplace submission form: new/update, ZIP or public GitHub/ref/subdirectory; select CN/US and desktop/cloud independently. VPSnet provider identifier and authenticated Connector are not yet approved. Static package validation cannot prove live onboarding. [Packet/guide](../distribution/clients/minimax/README.md). |
| [Qwen consumer browser](https://qwen.ai/) | Unknown intake | No verified public VPSnet submission intake. Consumer MCP/skill import, marketplace eligibility and region-specific rules remain unknown. |
| [Doubao consumer agents / former Coze publication channel](https://www.doubao.com/legal/privacy) | Blocked/limited | Coze explicitly removed NEW low-code agent publication to Doubao on 2026-07-01; previously published agents are unaffected. Direct Doubao partnership/creator intake for tools remains unknown; do not infer all Doubao agents were removed. |
| [Coze China custom MCP plugins / plugin store](https://docs.coze.cn/guides_create_a_plugin_based_on_mcp) | Submission/review | Create/import MCP plugin → test → Publish; public and enterprise plugin-store routes are separate. VPSnet customer infrastructure actions may need enterprise route; per-user OAuth end-to-end and current store eligibility need validation. |
| [Baidu ERNIE agents capability-plugin platform](https://agents.baidu.com/docs/develop/plugin/ability-plugin/basic/quick_start/) | Unknown intake | Legacy docs describe upload/domain → debug → review → publish, but current account intake was not verified. Substantive documentation could not be fetched; current eligibility, public intake and per-user authentication are unresolved. |

### European and enterprise platforms

| Surface | Route | Concrete intake / remaining gate |
| --- | --- | --- |
| [Dust](https://docs.dust.tt/docs/user-documentation/admins/tools-management/adding-an-mcp-server.md) | Submission/review | Provider-hosted community guidance invites test/auth/DCR instructions to its public intake contact; listing follows testing/approval/backlog. Actual personal OAuth, callback acceptance, safe mutation confirmations and reviewer access. [Packet/guide](../distribution/catalogs/dust/intake.md). |
| [Langdock](https://docs.langdock.com/en/using-langdock/integrations/mcp-directory) | Submission/review | Email official directory intake support@langdock.com using documented submission fields. Reviewer demo access/signup, official testing permission, actual OAuth and confirmations; at most 60enabled tools. [Packet/guide](../distribution/catalogs/langdock/intake.md). |
| [LightOn / Paradigm](https://docs.lighton.ai/en/administration/agent-management/mcp-servers) | Blocked/limited | Private enterprise admin MCP setup; public partnership inquiry exists, not listing approval. Customer browser OAuth and public publisher intake unverified. |
| [Sana Agents](https://support.sana.ai/en/articles/357502-mcp-integration-guide) | Private connection | Enterprise admin publishes custom MCP to workspace users/groups; no global catalog intake verified. Enterprise plan; actual personal OAuth and write confirmations. |
| [DeepL Agent](https://www.deepl.com/en/ai-agents) | Unknown intake | No verified incoming VPSnet plugin intake; DeepL outbound MCP and language app marketplace are different directions. Incoming remote OAuth/MCP eligibility unknown. |
| [Aleph Alpha / PhariaAI](https://docs.aleph-alpha.com/phariaai-dev-guide/latest/phariaai-applications/index.html) | New adapter/package | Organization applications can be developed; no verified incoming public MCP/plugin catalog. Custom application scope and per-user OAuth require separate design. |
| [deepset / Haystack](https://github.com/deepset-ai/haystack-integrations) | New adapter/package | Reviewed integration-page PR accepted by developer catalog after a working integration exists. OAuth-capable client/adapter example needed; header support alone is insufficient. |
| [Hugging Face Chat UI / Spaces / HuggingChat](https://huggingface.co/docs/chat-ui/configuration/mcp-tools) | Private connection | OSS Chat UI accepts remote MCP. Spaces discovery requires an actual hosted app; hosted HuggingChat support is not established. Validate exact deployed client/callback and approvals; no external-URL-only listing intake verified. |

### Builders and automation

| Surface | Route | Concrete intake / remaining gate |
| --- | --- | --- |
| [Microsoft Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent) | Private connection | Add existing MCP server to an agent; licensed/admin environment and actual OAuth test. Separate from Microsoft 365 public certification. |
| [Lovable](https://docs.lovable.dev/integrations/custom-mcp) | Private connection | Custom connection is per-user. Admin can add public/internal MCP Registry-compatible /v0/servers directory; no default registry. No verified self-service submission path for global featured connector catalog. Document native URL/OAuth install; login with a customer-owned selected test service. |
| [Replit](https://docs.replit.com/features/mcp/overview) | Private connection | Curated MCP list and audited partner skills exist; reviewed docs expose no open provider submission endpoint. Public one-click install link and GitHub skills work independently of curated acceptance. Add generated secret-free one-click URL to customer guide/release notes. |
| [Bolt / StackBlitz Bolt.new](https://support.bolt.new/building/using-bolt/connect-mcp) | Private connection | Built-in connectors and skills library exist; self-service public provider listing route not verified. Custom connectors and project/workspace skills can be shared through installation instructions. Document HTTP + MCP OAuth + VPSnet endpoint. |
| [v0 / Vercel](https://v0.app/docs/MCP) | Submission/review | Bring-your-own server immediately available to installing user/team. Public Vercel Marketplace requires native or connectable-account integration plus approval checklist and reviewer walkthrough; generic MCP URL alone is insufficient. Prepare custom-server setup guide and customer login smoke test. |
| [n8n](https://docs.n8n.io/integrations/builtin/credentials/mcp) | Private connection | In-product MCP registry mentioned by current docs; no provider submission/update policy verified. Existing core node suffices without custom community node. Public workflow-template route requires separate creator submission. Prepare small read-only workflow template and native credential instructions. |
| [Make](https://apps.make.com/c5ZhYquO55e90hoCJ0rzt) | Private connection | Verified-server dropdown exists; reviewed docs do not expose provider submission form/acceptance rule. Custom URL works independently. PulseMCP officially recommended for discovery. Document custom URL, OAuth and exact callback. |
| [Zapier / Zapier Agents](https://help.zapier.com/hc/en-us/articles/38777069364109-Connect-remote-MCP-servers-to-Zapier-using-MCP-Client) | Private connection | Custom server connection is not a named public Zapier app listing. Public VPSnet integration would require separate Zapier developer app; no MCP-only listing submission verified. Document Streamable HTTP + OAuth Yes + endpoint, without customer API key. |
| [Dify](https://docs.dify.ai/en/cloud/use-dify/workspace/tools) | Private connection | Native MCP connection is workspace configuration. Public Marketplace submits exactly one .difypkg per PR to langgenius/dify-plugins; CI+review; GitHub/local-file distribution alternatives. Use native MCP DCR first; maintain stable vpsnet identifier. |
| [Flowise](https://docs.flowiseai.com/tutorials/tools-and-mcp) | Blocked/limited | Custom flows/configuration; official tutorial links Docker MCP catalog. No open Flowise MCP-provider catalog submission path established. Do not label current hosted OAuth native compatible until tested. |
| [Langflow](https://docs.langflow.org/mcp-client) | Blocked/limited | Private/project server configuration. No verified public external MCP-provider listing route; bundled custom Python component would be separate contribution. Inspect current client auth capability; do not infer from Langflow-as-MCP-server OAuth docs. |
| [Open WebUI](https://docs.openwebui.com/features/extensibility/mcp/) | Private connection | Admin config gives instance availability; per-user OAuth. Open WebUI Community publishes skills/prompts/tools/functions, not direct global native MCP settings. Community account separate. Document DCR OAuth2.1, endpoint and minimal custom scopes. |
| [AnythingLLM](https://docs.anythingllm.com/mcp-compatibility/overview) | Blocked/limited | Community Hub accepts custom agent skills/flows/system prompts, a different format from native MCP configuration. Hosted AnythingLLM Cloud has no MCP support. Do not advertise hosted-cloud integration. |
| [LibreChat](https://www.librechat.ai/docs/features/mcp) | Private connection | Instance/user MCP config; docs allow Smithery discovery/install and server-specific guide contribution. No LibreChat global first-party plugin acceptance inferred. Prepare YAML sample without secrets and exact callback rule. |
| [OpenClaw / ClawHub](https://docs.openclaw.ai/cli/mcp/transports) | Direct source install | Public ClawHub skills/plugins with GitHub-backed publisher login; scan/moderation can hold/block visibility. Skill submission is concrete; approval untested. Prepare native config with explicit streamable-http and narrow scope. |
| [Hermes Agent / Nous Research](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) | Direct source install | Skills can be published to own GitHub repo via hermes skills publish --to github --repo owner/repo; taps, direct GitHub, skills.sh and well-known skill endpoints support discovery. No promise of global curated acceptance. Prepare mcp_servers snippet + explicit native login instruction and narrow scope. |
| [Dify public Marketplace](https://docs.dify.ai/en/develop-plugin/publishing/marketplace-listing/submit-plugin-to-marketplace) | New adapter/package | Submit one native .difypkg per reviewed PR to langgenius/dify-plugins. Implement/test native provider adapter and OAuth lifecycle, metadata/privacy and package validation. |
| [AnythingLLM managed Cloud](https://docs.anythingllm.com/cloud/limitations) | Blocked/limited | No MCP integration in documented managed Cloud limitations. Do not label Desktop/self-hosted MCP support as Cloud availability. |

### Registries and catalogs

| Surface | Route | Concrete intake / remaining gate |
| --- | --- | --- |
| [Official MCP Registry](https://modelcontextprotocol.io/registry/authentication) | Public record observed | Update SAME com.vpsnet/vpsnet with next approved immutable version; verify exact and latest records. Authorized publisher and reviewed version; registry 0.6.7 trails published/source 0.6.9. [Packet/guide](../server.json). |
| [GitHub MCP Registry](https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/) | Submission/review | Nominate the existing official registry record using prepared GitHub request. Curator approval; current search found no VPSnet result. [Packet/guide](../distribution/catalogs/github-registry/request.md). |
| [Smithery](https://smithery.ai/docs/build/publish) | Public record observed | Verify ownership of existing jonas-eqlv/vpsnet before updating; avoid duplicate namespace. Publisher control and proxy/OAuth routing remain unverified. [Packet/guide](../distribution/catalogs/smithery/README.md). |
| [Glama](https://glama.ai/mcp/faq) | Public record observed | Claim existing feed-import connector and configure isolated health-test profile. Ownership and authenticated scanner profile; Unhealthy badge is not proof of runtime outage. [Packet/guide](../distribution/catalogs/glama/listing.md). |
| [Docker MCP Catalog](https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md) | Submission/review | Submit remote catalog entry PR using current upstream contribution requirements. Actual Docker OAuth test, upstream checks and review; no matching entry verified. [Packet/guide](../distribution/catalogs/docker/README.md). |
| [PulseMCP](https://www.pulsemcp.com/api) | Unknown intake | Verify existing feed import and current submit route before filing a duplicate. Public lookup/submit blocked 403; acceptance unknown. [Packet/guide](../distribution/catalogs/pulsemcp/listing.md). |
| [MCP.so](https://mcp.so/) | Submission/review | Use reviewed current form/issue route after resolving intake requirements. No matching search result; form/payment conflict must be resolved before any purchase. [Packet/guide](../distribution/catalogs/mcp-so/issue.md). |
| [mcpservers.org](https://mcpservers.org/servers/bacarrdy/vpsnet-mcp) | Public record observed | Existing indexed listing; verify ownership/edit route before submitting a duplicate. Fresh provider-indexed evidence; direct fetch 403 limits confirmation. [Packet/guide](../distribution/catalogs/mcpservers-org/listing.md). |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md) | Submission/review | Submit prepared contribution PR. Maintainer review; absent from checked README. [Packet/guide](../distribution/catalogs/community/awesome-mcp-servers.md). |
| [punkpeye/awesome-remote-mcp-servers](https://github.com/punkpeye/awesome-remote-mcp-servers/blob/main/CONTRIBUTING.md) | Submission/review | Submit remote PR with actual handshake/badge evidence. Maintainer/CI review; absent from checked README. [Packet/guide](../distribution/catalogs/community/awesome-remote-mcp-servers.md). |
| [jaw9c/awesome-remote-mcp-servers](https://github.com/jaw9c/awesome-remote-mcp-servers) | Submission/review | Submit contribution using current repository process. Maintainer review; absent from checked README. [Packet/guide](../distribution/catalogs/community/awesome-remote-mcp-servers.md). |
| [Cursor Directory community plugins](https://cursor.directory/plugins/new) | Unknown intake | Verify community portal before using prepared manual listing. Lookup rate-limited 429; this is separate from official Cursor marketplace. [Packet/guide](../distribution/catalogs/community/cursor-directory.md). |

## Intake checklist and prepared packets

Reuse the [catalog kit](../distribution/catalogs/README.md) and its existing
provider-specific drafts. New [Langdock](../distribution/catalogs/langdock/intake.md)
and [Dust](../distribution/catalogs/dust/intake.md) packets contain public product
facts and the precise remaining send gates. They are drafts, not submission receipts.

Before any submission:

- Select an exact reviewed commit, immutable native artifact/version and hash.
  Use [directory readiness](DIRECTORY_READINESS.md) and keep source changes out of
  an already published version.
- Confirm the publisher account, domain/namespace and maintenance authority.
  Supply the provider's actual format; do not rename a portable ZIP into another
  vendor's package extension.
- Test native OAuth, separate users, selected services, scope upgrades,
  refresh/revocation/reconnect and mutation approval. Discovery is not permission.
  Preserve truthful tool annotations; adapt enabled tool subsets in the client.
- Prepare isolated reviewer access or a working demo signup path, actual test
  steps, public policy/support links and logo. Keep credentials, account details,
  private QA and submission receipts outside Git and package files.
- Submit only through the verified intake after authorization; record the real
  submission ID, review decision and public listing. A draft is not publication.

Langdock permits at most 60 **enabled** tools and defaults newly saved tool
confirmation to off: select a bounded subset, explicitly enable confirmations
for changes/sensitive actions and test them. Dust should use **Personal Level
Credentials**, not a shared VPSnet customer grant. Sana is enterprise workspace
distribution. LightOn, Flowise, Langflow, Roo and some other clients still need
proof of a safe customer OAuth path. Do not solve missing OAuth by embedding a
shared administrative secret.

## Updates and notification limits

Follow [updates and releases](UPDATES.md) and the active client's native guide.
Track these independently: source commit, published bundle/hash, deployed gateway,
official registry version, downstream listing/version, installed bundle and
active-session tools/skills. Recheck public listing evidence after authorized
publication rather than inferring it from GitHub tags.

Native update, marketplace refresh, tool discovery, reconnect and new conversation
are different actions. None grants additional scopes. The current stateless
gateway has no retained notification stream and does not force an update notice
into all clients. API events or MCP list changes do not replace bundled skills.
Document an optional explicit version check; do not promise forced automatic updates.

Microsoft personal Copilot, Microsoft 365 Copilot and GitHub Copilot are separate.
Qwen Code is not Qwen browser. You.com/DeepL outward MCP servers do not establish
incoming VPSnet client support. DeepSeek/GLM model APIs do not create consumer
plugin listings. Coze removed new low-code publication to Doubao on 2026-07-01;
already published agents are unaffected. Baidu's indexed agent/workflow retirement
notice does not prove every legacy capability-plugin route is closed; its current
intake and per-user auth remain unverified.
