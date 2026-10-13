# Cline Marketplace issue draft

Open the [official submission form](https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml)
when production readiness and the Cline installation test are complete.

Title: [Server Submission]: VPSnet

## GitHub Repository URL

https://github.com/bacarrdy/vpsnet-mcp

## Logo Image

Upload [icon-400.png](icon-400.png), a 400×400 PNG exported from the project's
existing logo. After these assets are published, the copyable public image URL is:
https://raw.githubusercontent.com/bacarrdy/vpsnet-mcp/main/distribution/catalogs/cline/icon-400.png

## Installation Testing

- [ ] Confirm after testing: Cline successfully sets up the server using only
  `README.md` and/or `llms-install.md`.
- [ ] Confirm after verification: the server is stable and ready for public use.

These are mandatory upstream confirmations. Leave them unchecked until true.
A generated configuration or protocol unit test does not establish either.

## Additional Information

VPSnet lets Cline inspect and manage existing VPSnet servers, applications,
DNS, private networks and Functions. Linux diagnostics and permitted file or
command operations can help investigate deployment issues and repair selected
services. Customers connect through OAuth and choose the services and
permissions they authorize. The hosted directory profile excludes purchases,
billing and account API-key management.

Installation instructions: https://github.com/bacarrdy/vpsnet-mcp/blob/main/llms-install.md

Endpoint: `https://mcp.vpsnet.com/mcp`; transport: Streamable HTTP. Use native
OAuth authorization with dynamic client registration. No model API key or
VPSnet account API key is needed for this remote connection.

Sources: [Submission requirements](https://github.com/cline/mcp-marketplace#how-to-submit-your-mcp-server),
[issue form](https://github.com/cline/mcp-marketplace/blob/main/.github/ISSUE_TEMPLATE/mcp-server-submission.yml).
