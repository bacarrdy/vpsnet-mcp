# MCP server 2.7.0

Published to npm on 2026-11-12.

## Release notes

New in vpsnet-mcp 2.7.0:

- Manage the firewall of your server's public interface (VPS and Cloud VPS): read the rules, replace them, send them to the server again.
- Choose an additional address as the source of a server's outgoing connections.
- Set and reset reverse DNS of additional, floating, VPN and load-balancer addresses.
- Put an additional address directly on a server that has its own IP, and check that it is reachable.
- Forward ports from a private network's NAT address, also to servers that have their own IP.
- Rebuild a public load balancer.
- More VPN controls: rename, restart, rebuild, image update, who may connect, internet exit, second line, BGP, IPsec settings, tunnel tests, key rotation, health webhooks.
- See which SSH keys are on a server and remove one (local package).

See [CHANGELOG](../CHANGELOG.md) for the tool names.

## Publication and deployment

The package is published to npm from this commit. The hosted connector at https://mcp.vpsnet.com/mcp is updated separately.
