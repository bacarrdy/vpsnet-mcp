# Smithery URL listing

Use [Smithery's new-server flow](https://smithery.ai/new), select URL publishing,
and enter `https://mcp.vpsnet.com/mcp`. Use the name and description in
[the reusable metadata](../metadata.json).

The current documented CLI alternative is:

```sh
smithery auth login
smithery mcp publish 'https://mcp.vpsnet.com/mcp' -n @vpsnet/vpsnet
```

`@vpsnet/vpsnet` is a proposed namespace/name, not a claimed account. Confirm
publisher ownership and the installed CLI syntax before publishing. OAuth is
handled through the hosted authorization flow; do not add an API-key config
schema. Smithery's current URL requirements are Streamable HTTP and OAuth when
authentication is needed, with automatic client registration via client-ID
metadata documents.

Smithery Gateway proxies requests to VPSnet. Complete the OAuth scan using an
isolated account and a limited grant, then verify the gateway path before
claiming it works. Do not publish customer tokens or grant all permissions for
the sake of listing. An auth-required scan may prompt for authorization.

If the scan cannot complete, Smithery supports a static server card at
`/.well-known/mcp/server-card.json`. No static card is included here: tool
availability is authorization-dependent, so a card must be deliberately
reviewed and describe the actual published discovery profile. The endpoint is
not created by placing a file in this submission kit.

After publication, complete Smithery's Settings → Verification checklist and
record the assigned live URL privately.

Sources: [URL publishing and scanning](https://smithery.ai/docs/build/publish),
[CLI](https://github.com/smithery-ai/cli).
