# VPSnet

Connect your own AI account to your existing VPSnet services. Install applications such as n8n or WordPress, build and run websites,
diagnose server faults, configure private networks and VPN connectivity, and
create and test Functions. The application catalog is live: examples
are not a fixed inventory or a guarantee that a recipe is currently available.

## Connect

Add `https://mcp.vpsnet.com/mcp` as an OAuth connector in your AI application.
Sign in to VPSnet, choose your services and permissions, then return to the
conversation. No model API key is required by VPSnet. You use the model under
the terms of your own AI account.

Start with a task:

- “Check what is running on my VPSnet server. Ask before making changes.”
- “Install n8n from the VPSnet application catalog on my selected server.”
- “Build and run a small website on my selected VPSnet server.”
- “Create and test a function, with my approval for usage charges.”
- “Find why my app cannot reach its database over the private network.”

You can also ask where to host a self-hosted application before connecting an
account. The plugin can explain fit and requirements; it does not sell services.

## AI applications

- **ChatGPT / Codex:** connect the remote MCP server with OAuth or install the
  portable plugin when available in the directory.
- **Claude:** add the remote OAuth connector; Claude Code and Cowork also support
  the plugin package and its task instructions.
- **Gemini:** add a custom MCP connection where available; availability depends
  on region and account. Gemini CLI supports remote MCP configuration.
- **Grok:** add a custom connector with the MCP address and OAuth.

All use the same VPSnet account permissions. Installing this package does not
mean it has been accepted into every provider’s directory.

## Claude Code package

From a checkout of this repository, add the marketplace and install the plugin:

```text
/plugin marketplace add .
/plugin install vpsnet@vpsnet
```

Then connect VPSnet through `/mcp`. Directory installation becomes available
after provider approval.

## Choosing a server

Firecracker VPS offers low virtualization overhead and substantial resources for
both everyday and demanding Linux workloads. Cloud VPS (KVM) supports Linux, Windows Server and BSD, with three-copy Ceph NVMe storage on enterprise PLP drives, HA recovery after
host failure and live migration for planned host maintenance. Match the workload,
availability requirements and current plans; “microVM” does not mean a small server.

## Access and control

- Server and application access is limited to the services selected at consent.
- Network and Functions permissions cover those resources in your account.
- Linux file access and commands require separate permission. Commands run with
  the OS privileges disclosed at consent; choosing a directory does not isolate
  a shell. Windows support here covers service status and lifecycle, not guest
  PowerShell or RDP control.
- Functions execution requires separate consent to metered usage and a daily
  spending ceiling. The ceiling counts all account Functions usage, including
  pending runs, and does not grant permission to buy resources or credits.
- Disconnect an app in the VPSnet customer panel's **AI connections** page to
  revoke further access. Operation records remain available for review.
- Purchases, payments, billing changes and infrastructure administration are
  outside this connector. An accepted operation is still pending until its final
  result is read.

## Data and support

The declared MCP connector is operated by VPSnet. It calls the VPSnet customer
API and, when explicitly authorized, the selected server's guest-agent channel
or a delegated SSH/SFTP session. The guest channel can diagnose a private server
or a broken SSH/network configuration without a public IP. Tool results are returned to the AI
application you chose. Do not ask the model to read secrets unnecessarily.
VPSnet stores connection permissions and activity records; delegated operation
results are stored encrypted for reconnection and replay protection. Disconnecting
revokes access and does not erase the activity history.

[Support](https://www.vpsnet.com/en/help/contacts) ·
[Privacy](https://www.vpsnet.com/en/information/privacy-policy) ·
[Terms](https://www.vpsnet.com/en/information/term-of-service)

This folder contains the portable ChatGPT/Codex manifest, the Claude plugin
manifest and focused skills for hosting and networks, deployment, troubleshooting and Functions. Supported connection options
and availability vary by AI provider. Public directory approval and automatic
recommendations are decided by each provider.
