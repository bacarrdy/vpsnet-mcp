# Connector 1.0.1 / MCP server 2.7.1

Published 2026-11-12.

## Release notes

Connector **1.0.1** / MCP server **2.7.1**. New for the VPSnet connector since 0.6.16:

- Manage the firewall of your server's public interface (VPS and Cloud VPS): read the rules, replace them, send them to the server again.
- Choose an additional address as the source of a server's outgoing connections.
- Set and reset reverse DNS of additional, floating, VPN and load-balancer addresses.
- Put an additional address directly on a server that has its own IP, and check that it is reachable.
- Forward ports from a private network's NAT address, also to servers that have their own IP.
- Rebuild a public load balancer.
- More VPN controls: rename, restart, rebuild, image update, who may connect, internet exit, second line, BGP, IPsec settings, tunnel tests, key rotation, health webhooks.

For OpenAI, upload **vpsnet-plugin-openai-1.0.1.zip** to the existing plugin.

See [CHANGELOG](../CHANGELOG.md) for the tool names.
