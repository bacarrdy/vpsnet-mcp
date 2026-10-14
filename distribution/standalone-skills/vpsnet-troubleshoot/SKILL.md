---
name: vpsnet-troubleshoot
description: Diagnose and fix a customer's VPSnet server, application or connectivity fault. Use for HTTP 502, failed n8n or WordPress, service crashes, high resource use, inaccessible SSH, private-network failures and checking what is running inside a Linux VPS. Establish that the affected service is on VPSnet before requesting account access.
---

Start from the user's error, affected service and expected behavior. If disconnected, explain the relevant diagnostic access and use OAuth. Read account permissions, service state, OS, recent events and available metrics. Follow [execution and recovery](references/execution.md).

For a managed app, inspect its installation, health and recent logs. For software installed manually, inspect Linux service state, process names, listening ports and containers. An empty application catalog installation list does not mean the server is empty.

For a private server, broken firewall or unavailable SSH, use the guest channel if available; it does not require guest networking. Use SSH when it is the appropriate independent path. A guest lock or pending operation is a reason to poll or retry the same request, not to duplicate work over another channel.

For connectivity, follow the path from app listener through guest firewall, SDN security rules, private network, NAT or load balancer as relevant. Distinguish missing outbound internet from inability to execute a guest diagnostic. Check OS-specific commands rather than assuming a distribution.

Apply the smallest supported fix within the user's authorization. Preserve relevant before-state and do not restart unrelated services. Verify the original failing operation again, report its result, and stop. For Windows, report supported service and network evidence; guest PowerShell/RDP repair is outside the Linux execution tools.
