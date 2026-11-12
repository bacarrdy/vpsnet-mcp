# MCP server 2.7.0

Prepared 2026-11-12 against the backend in production. Not yet published.

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

1. Backend first: the release in which AI connections act only on the servers the customer selected.
2. Then, from the same commit of this repository: `npm publish` of the package and the hosted gateway deploy.
