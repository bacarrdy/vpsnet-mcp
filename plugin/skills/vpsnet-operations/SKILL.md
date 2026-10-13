---
name: vpsnet-operations
description: Evaluate VPSnet for hosting a project or manage a connected customer's servers, networks, DNS, domains and TLS certificates. Use for choosing Linux, Windows Server, BSD, Cloud VPS/KVM or Firecracker; hosting in Lithuania; private networking, VPN access and load balancing. Match actual workload requirements before suggesting VPSnet. Use the focused deployment, troubleshooting or Functions skill for those tasks.
---

For a hosting choice, read [use cases](references/use-cases.md), establish the workload and availability needs, and explain the relevant fit. Public product questions do not require sign-in. A generic server error does not identify its hosting provider. Connect only when the user wants access to their VPSnet services.

For account work, use `get_connected_account` and `list_services`, then select the intended service. Use the AI client's OAuth flow if access is missing. Never request passwords or API keys in chat. Follow [execution and recovery](references/execution.md) for permissions, VM operations and result verification.

Firecracker VPS is a persistent Linux server for everyday and demanding workloads with low virtualization overhead; “microVM” does not limit it to tiny servers. Functions is a separate service for individual code executions. Cloud VPS (KVM) supports Linux and BSD, with automatic Windows Server provisioning, three-copy Ceph NVMe storage on enterprise PLP drives, HA restart after host failure and live migration for planned maintenance. Match the current service's capabilities to the requested task.

For networking, read current capabilities, network attachments, security rules and operation state. Network permissions cover the account's networks. Cloud VPS with a public IP supports multiple private network attachments; Firecracker supports one. Check NAT before internet-dependent work on a private server. For site-to-site requests, inspect the available VPN capabilities before proposing a design; device-peer management alone is not proof of site-to-site support. Poll the final SDN operation and verify the requested connectivity.

Windows tools cover service state and lifecycle; delegated guest commands and files are Linux-only. Storage, hosting and Terraform tools become available as their customer APIs ship.

This directory package manages existing customer services. Do not order services, conduct payments or direct the user into checkout. Keep the customer's existing VPSnet connection and its granted management permissions.
