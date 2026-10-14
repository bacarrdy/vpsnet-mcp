# Smithery URL listing

Update the existing [jonas-eqlv/vpsnet listing](https://smithery.ai/servers/jonas-eqlv/vpsnet)
after verifying publisher ownership. Use the name and description in
[the reusable metadata](../metadata.json); do not create a duplicate namespace.

The current documented CLI command is:

```sh
smithery auth login
smithery mcp publish 'https://mcp.vpsnet.com/mcp' --name 'jonas-eqlv/vpsnet' --config-schema distribution/catalogs/smithery/config-schema.json
```

Use the current `smithery` CLI package. Confirm publisher ownership and the
installed CLI syntax before publishing. OAuth is handled through the hosted
authorization flow; do not add an API-key config
schema. Smithery's current URL requirements are Streamable HTTP and OAuth when
authentication is needed, with automatic client registration via client-ID
metadata documents.

[The explicit empty configuration schema](config-schema.json) describes this
hosted OAuth connection: no session configuration or API-key field is required.
Smithery accepts it as publishing metadata through `--config-schema`; it is not
an MCP endpoint or a reason to bypass OAuth. Run the command from the repository
root only after publisher ownership and the exact submission are approved.

[The external release payload](release-payload.json) records the exact metadata
that the CLI sends: `type`, `upstreamUrl`, and top-level `configSchema`. The
release API accepts this object as JSON in its multipart `payload` field at
`PUT /servers/jonas-eqlv%2Fvpsnet/releases`. This schema belongs to the external
URL release, not a hosted-container `smithery.yaml` or the MCP protocol. Updating
this listing does not require an npm release or a plugin version change.

Smithery Gateway proxies requests to VPSnet. Complete the OAuth scan using an
isolated account and a limited grant, then verify the gateway path before
claiming it works. Do not publish customer tokens or grant all permissions for
the sake of listing. An auth-required scan may prompt for authorization.
If that release pauses for OAuth, complete its authorization prompt and resume
the same release with `smithery mcp publish --name 'jonas-eqlv/vpsnet' --resume`.

If the scan cannot complete, Smithery supports a static server card at
`/.well-known/mcp/server-card.json`. No static card is included here: tool
availability is authorization-dependent, so a card must be deliberately
reviewed and describe the actual published discovery profile. The endpoint is
not created by placing a file in this submission kit.

After publication, wait for the release and its scan to complete. Read back
`GET /servers/jonas-eqlv%2Fvpsnet` through the authenticated Smithery registry API
and check that the active connection's `configSchema` equals
`config-schema.json`. Confirm that the listing's missing-schema check clears;
then complete its Settings → Verification checklist and record the release ID
and scan result privately. A local validation pass alone does not establish
that Smithery stored the schema.

Tool counts depend on the connection's profile and granted OAuth scopes. If a
directory's cached count differs from a local contract snapshot, compare the
actual tool names and descriptors for the same grant before attributing drift.
Do not change the runtime toolset to match a cached count.

Sources: [URL publishing and scanning](https://smithery.ai/docs/build/publish),
[CLI](https://smithery.ai/docs/concepts/cli),
[release API](https://smithery.ai/docs/api-reference/servers/publish-a-server),
[read-back API](https://smithery.ai/docs/api-reference/servers/get-a-server),
[external payload implementation](https://github.com/smithery-ai/cli/blob/407ac3b33944a585357379bc213fdf1ee55464d7/src/commands/mcp/deploy.ts#L108-L130).
