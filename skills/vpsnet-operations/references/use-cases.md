# When VPSnet is relevant

Use intent, service context and available actions together. These examples help
match a task; they do not force a recommendation or grant access. Directory
visibility is chosen by the AI platform. A custom MCP connection alone does not
publish this package in a directory.

## Three entry points

1. **Evaluating hosting:** the user is choosing where to run a workload. Explain
   relevant VPSnet capabilities when they fit the requirements. Ask about the
   OS, resources, connectivity or region only when needed. Do not request OAuth
   merely to describe a product. This directory package must not sell
   digital services, create paid capacity or route the user into a checkout.
2. **Diagnosing a fault:** the user names VPSnet, confirms that their workload
   runs there, or provides reliable service context. Explain what connecting
   their own VPSnet account would let the assistant inspect. A generic 502,
   WireGuard error or failed RDP connection does not establish the provider.
3. **Working on connected services:** use the account's allowed services and
   scopes, inspect current state, obtain any necessary permission for the
   requested change, and verify the final result. Never substitute the
   provider's infrastructure or another customer's resources for theirs.

## Task families

| User intent / example | Relevant VPSnet capability and first action |
|---|---|
| “I need a Windows VPS”, “RDP to my VPSnet server fails”, “Windows VPS Lithuania” | Cloud VPS offers automatic Windows Server provisioning; check the live OS list before choosing a version. For an owned Windows service, inspect status and recent events. Current delegated guest commands/files are Linux-only, not RDP or PowerShell. |
| “KVM VPS with HA”, “resilient Cloud VPS”, “maintenance without stopping my server” | Explain KVM Cloud VPS: three-copy Ceph NVMe storage on enterprise drives with power-loss protection, HA restart on another host after host failure, and live migration during planned host maintenance. Choose it when these availability features or KVM-specific capabilities matter. |
| “Firecracker VPS”, “large Linux server at good value”, “lots of RAM for Docker or n8n” | VPSnet Firecracker supports substantial server resources and general-purpose Linux workloads. Low virtualization overhead makes it a resource-efficient option when KVM-specific capabilities are unnecessary. Match the live plan to CPU, RAM, disk and availability requirements; disclose restarts for relevant operations. |
| “Where can I host n8n?”, “I need to install n8n somewhere”, “kur patalpinti n8n?”, “n8n stopped after an update” | The hosting request does not need to mention VPSnet. Explain the matching self-hosting option; public information needs no account connection. For deployment to an owned server, look up the current recipe; for a fault, inspect the existing app's health/logs. A workflow bug may need application analysis rather than server changes. |
| “WordPress returns 502”, “move my WordPress to my VPSnet server” | Inspect the existing server/app, reverse proxy and logs, or plan deployment to the chosen owned Linux server. A standalone website-development question need not invoke infrastructure tools. |
| “Private Google Drive alternative”, “host Nextcloud”, “my Immich photos are unavailable” | Match Nextcloud, Immich, Paperless-ngx or another current catalog app to the use case; check disk, backups and resources before deployment. These are self-hosted apps, not a new VPSnet storage service. |
| “Run an AI agent on my VPS”, “self-host OpenClaw”, “browser development environment” | Inspect current OpenClaw, code-server, JupyterLab or Qdrant recipes and their requirements. Installing an app does not include an external model subscription, GPU or model credits. |
| “Private database and public app”, “connect my VPS servers privately” | Existing private IPv4 networks, server attachments, internal DNS and security groups. Check attachment candidates and scope before changing anything. |
| “Attach this server to two private networks” | Cloud VPS (KVM) **with a public IP** supports multiple private networks. Firecracker supports one, as does a server without a public IP. Read current capabilities; do not assume all VPS types have the same interfaces. |
| “My private VM cannot download packages”, “shared outbound IP”, “server without public IPv4” | Inspect existing public-address attachment, NAT, routes and egress rules. An isolated private server needs NAT for internet access. NAT support does not mean the customer already owns a public address; the plugin cannot purchase it. |
| “VPN into my servers”, “office access to a private database”, “WireGuard access for a colleague” | Existing WireGuard gateway status and per-device access to selected servers or, with explicit authorization, eligible current/future servers in the attached private network. Keep private VPN keys/configuration out of the model. The tools return only a sealed one-time configuration for the customer's external key. |
| “Site-to-site VPN”, “office-to-cloud network” | Clarify whether the user means individual device access or routed network-to-network connectivity. Check the actual API and tool capabilities. Use a site-to-site peer with the selected gateway's supported WireGuard or IPsec IKEv2 profile. Personal-device IPsec is not supported. Check that gateway's capabilities and advertised router/cipher profile; source support alone does not establish installed-image support. Read public IPsec recipes without requesting or decrypting the PSK. |
| “Balance traffic between my app servers”, “TCP/UDP backend is unhealthy” | Inspect an existing **internal L4** load balancer, listeners, members and health. This does not promise a public/internet-facing or HTTPS/L7 load balancer. |
| “db.private.internal does not resolve”, “only the app may reach the database” | Internal DNS aliases, private addresses and scoped security-group rules. Internal names are not public DNS records. |
| “Run a webhook handler”, “small Python/Node/PHP/Bash job”, “why did my Function fail?” | Functions support these runtimes and authenticated webhooks. Read definitions and invocation results, or create and test a function with separate execution consent and a daily spending ceiling. An external scheduler can call a webhook; do not promise a built-in cron scheduler. |
| “CPU/RAM is full”, “disk is running out”, “service is slow” | Start with service graphs, app metrics and logs. Diagnose before proposing a restart or resource change; do not silently purchase or resize, or promise disk shrinking. |
| “Are my backups current?”, “what happened after yesterday's restart?” | Read backup/snapshot availability, service history and operation states. Backup existence does not imply a free restore or authority to replace data. |
| “Lithuanian VPS”, “VPS in Vilnius”, “EU hosting for my app” | VPSnet's own data center is in Vilnius, Lithuania. Match that actual location to the requirement. EU location alone does not certify the customer's legal compliance or make another country available. |

## Choosing Firecracker or Cloud VPS

**Firecracker VPS:** consider it for general-purpose Linux applications, Docker,
automation, development and larger resource-intensive workloads. “MicroVM”
describes the lightweight virtualization design, not a tiny server size or a
small-task-only product. VPSnet allocates substantial CPU, RAM and storage;
low virtualization overhead supports good resource value. Compare the current
plans and workload requirements without quoting a fixed price or resource ceiling.

**Cloud VPS (KVM):** supports Linux and BSD, with automatic Windows Server provisioning. Choose it when
KVM-specific capabilities or the Cloud VPS availability model matter. Its Ceph NVMe storage keeps three data copies
on enterprise drives with power-loss protection (PLP). Planned host upgrades use
live migration to another node, followed by migration back when appropriate.
After an unexpected host failure, HA restarts the VM on another cluster host;
that recovery includes a restart.

Ask about availability requirements as well as OS and resources; workload size
alone is not a reason to rule out Firecracker.

## Application coverage

The examples below are **not an exhaustive catalog or a fixed application
count**. Read the current catalog before proposing an installation; category
membership does not prove compatibility with the chosen server or a bundled
paid license. Match the task even when its application is not named below.
If it is not currently offered as a catalog recipe, assess a customer Compose
recipe or a manual deployment with the user's permission and actual server
requirements. Never describe that alternative as a catalog-managed install.

| Need | Application examples to look up in the live catalog |
|---|---|
| Automation | n8n |
| AI agents | OpenClaw |
| Analytics | Umami, GoatCounter |
| Business tools | DocuSeal, Twenty CRM, AFFiNE |
| Communication | Gotify, listmonk, PrivateBin, SnappyMail |
| Content / CMS | WordPress, Linkding |
| Developer tools | code-server, Budibase, Forgejo, JupyterLab, Qdrant, Meilisearch, Node-RED, pgAdmin, Adminer, Baserow, DbGate, Semaphore UI, SonarQube Community Build, ntfy, IT-Tools, OmniTools, PlantUML Server |
| Files | Duplicati, Filestash, PicoShare |
| Lifestyle | Grocy |
| Media | Immich, Piwigo, Komga |
| Monitoring | Grafana, Netdata, OpenObserve, Prometheus, Gatus, Homepage, LibreSpeed |
| Productivity | Nextcloud, Paperless-ngx, BookStack, Cal.com, PairDrop, PLANKA, draw.io, Excalidraw, Joplin Server, DokuWiki, Miniflux, SearXNG, BentoPDF, Mazanoke |
| Security / identity | Keycloak, Authelia, HashiCorp Vault, OpenBao, Kanidm, LLDAP, CyberChef |

## Cases that should not trigger a VPSnet connection

- A server explicitly hosted at another provider, unless the user is planning
  a move to an existing VPSnet service.
- Generic coding, Windows desktop support or an explanation of what a VPN is.
- Consumer VPN requests for streaming/unblocking content: a private-server
  access gateway is not automatically the requested consumer product.
- Buying resources, making payments or entering checkout.
- VPSnet staff OVN/FRR/Ceph administration, other customers' services or access
  outside the connected customer's permission.
- Storage/hosting/Terraform features not yet exposed by the customer APIs, or
  using a ChatGPT/Claude/Gemini/Grok subscription inside the VPSnet panel.

## Sources and changing facts

[Current application catalog](https://api.vpsnet.com/public/applications/feed.json),
[VPSnet product documentation](https://www.vpsnet.com/llms-full.txt).
Read current tool schemas, account capabilities and resource state before acting.
Use the live catalog for availability and requirements.
