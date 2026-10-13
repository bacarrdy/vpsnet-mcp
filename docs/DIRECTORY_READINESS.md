# Directory submission readiness

Checked against the official requirements on 2026-10-13. This is a release
candidate, not a provider approval or a guarantee of proactive recommendations.
The public plugin README, manifests and skill are in English. Internal testing
and deployment materials are maintained separately in private repositories.

| Provider | Submission or connection format | Remaining external acceptance |
| --- | --- | --- |
| OpenAI | `vpsnet-plugin-0.6.1.zip`, uploaded at https://platform.openai.com/plugins | Publisher access, domain challenge, live OAuth, reviewer account, demo video, portal validation and review |
| Claude | Public `bacarrdy/vpsnet-mcp` GitHub repository, `plugin` path, `main` branch; submit both connector and plugin bundle at https://claude.ai/directory/manage | GitHub publisher access, live OAuth, portal checks, reviewer account and review |
| Gemini | Custom remote MCP in eligible Connected Apps accounts, or the original Gemini CLI | Real account and regional availability; no verified public self-service directory submission path |
| Grok | Custom remote MCP at https://grok.com/connectors | Real account OAuth; no verified public self-service directory submission path |
| Gemini CLI | Root `gemini-extension.json` and complete native release archive | Public repository/release, `gemini-cli-extension` topic, actual client sign-in and gallery validation |
| Cursor | `plugin/.cursor-plugin/plugin.json` and root `.cursor-plugin/marketplace.json` | Public repository, native OAuth and marketplace review |
| Kiro | Portable Agent Plugins bundle; standalone scoped MCP configuration also provided | Power OAuth scope behavior must pass on the actual client before submitting |
| Kimi Code / Work | Native `kimi.plugin.json` bundle; Work imports through Plugin Builder | Code sign-in, separate Work conversion/test and official marketplace application |

Additional registration drafts and provider requirements are maintained in the
[catalog kit](../distribution/catalogs/README.md). MiniMax requires provider
App/Connector onboarding before an OAuth plugin can be submitted. A registry
entry does not grant approval in another AI application's marketplace.

## Automated checks

Run `node --test test/plugin-package.test.mjs test/distribution-package.test.mjs`,
`python3 scripts/package-distribution.py` and
`claude plugin validate ./plugin`. The offline validator checks package paths,
file limits, UTF-8 text, matching versions, a substantive README, license,
listing lengths and URLs, at most three starter prompts, optional brand-color
contrast, five positive and three negative review cases, and production MCP
configuration without credentials. It runs before the plugin ZIP is built.
Regression tests reject excessive prompts, low contrast, insufficient README
text, symlinks and embedded reviewer credentials.

The HTTP test suite also checks advertised tool titles, name lengths, OAuth
security metadata and explicit read-only/destructive/open-world hints. Opening
a Linux session is marked destructive because it provisions SSH access. These
read-only tools are bounded by the account, selected VM or VPSnet catalog and
use `openWorldHint: false`; arbitrary command execution keeps it `true`. These
checks complement provider portal scanners; they do not reproduce all of them.

The portable manifest uses Streamable HTTP and the separate Claude MCP manifest
uses Claude's `http` transport identifier. The package has no executable hooks,
embedded tokens, billing tools or purchase links. Linux commands require explicit
customer permissions and operate with the documented OS authority. Arbitrary
command execution is disclosed, not represented as a read-only diagnostic action.

## Production and reviewer prerequisites

Verify OAuth/PKCE, refresh, selected-service filtering, revocation and VM file
and operation behavior in a test environment. Validate each provider with a real
account before claiming compatibility. Keep test reports and account details
private.

Before submission, enable and verify OAuth at the production URL after staging
acceptance. Use an isolated, populated reviewer account reachable without the
credentials in the private portal fields, not Git or a ZIP. Record an accessible
demo of the actual positive cases. Serve OpenAI's exact domain challenge only
after its portal issues it. The public privacy, terms and support URLs must
remain reachable and accurately describe deployed retention and data handling.

The OpenAI submission-errors page still mentions annotation justifications,
while its current plugin guidelines explicitly say they are no longer required.
We supply explicit annotations and do not invent an undocumented metadata field;
provide explanations in the portal if its live review asks for them.

## Official references

- [OpenAI submission](https://developers.openai.com/plugins/deploy/submission),
  [validation errors](https://developers.openai.com/plugins/deploy/submission-errors),
  [guidelines](https://developers.openai.com/plugins/plugin-guidelines).
- [Claude submission](https://claude.com/docs/plugins/submit),
  [plugin checklist](https://claude.com/docs/plugins/pre-submission-checklist),
  [connector directory](https://claude.com/docs/directory/publish).
- [Gemini custom MCP](https://support.google.com/gemini/answer/17209137),
  [Grok connectors](https://docs.x.ai/grok/connectors).
