---
name: vpsnet-deploy
description: Install or configure an application, deploy a project, or build and run a website or system on an existing VPSnet Linux server. Use for n8n, WordPress, Nextcloud, Docker Compose and custom projects on Cloud VPS/KVM or Firecracker. Inspect the live catalog before selecting a managed recipe; verify the running result.
---

On first VPSnet use in a conversation, check once with `get_update_info` when available. Read the installed [plugin version](../vpsnet-operations/references/plugin-version.json) and pass its `plugin_version` as `pluginVersion`. If unreadable, omit the version; never infer it from the host application, gateway or repository HEAD. Give one advisory only for a known older version, then continue the task. Stay quiet for current or unknown versions unless asked; do not repeat checks or dismissed notices.

Identify the connected account and target server. Read its OS, available resources, existing applications and networking. Follow [execution and recovery](../vpsnet-operations/references/execution.md). Ask only for missing requirements that change the deployment; reuse decisions and authorization already supplied.

## Catalog applications

Read the current application catalog and the recipe's deployment options, required OS and resources. Use the catalog installation tools for a matching requested application. Poll installation state, health and relevant logs until there is a final result. An accepted installation is not a working application. Check its actual address or endpoint and tell the user any first-login step without displaying credentials.

## Custom projects and websites

For a project without a suitable catalog recipe, inspect its runtime, source and deployment needs. Prefer a validated customer Compose recipe when it fits. Otherwise use authorized guest or SSH operations for a manual deployment and label it accurately. Preserve unrelated running services and data. Read existing files before changes, create the requested implementation, run meaningful checks, and use a persistent service or container with restart behavior.

Check local health first, then the intended client-facing endpoint. Configure only the required network ports and DNS within the user's request. A private server may be reached through an existing load balancer or VPN; internet downloads require working egress. Explain missing NAT or public routing rather than adding paid capacity or broadly opening a firewall. Do not call a localhost-only preview a published website.

Finish with the reachable address, what was deployed, verification and any remaining user action. Retain operation IDs for recovery. Remove only temporary resources created for the task.
