---
name: vpsnet-functions
description: Create, edit, run and diagnose VPSnet Functions, webhook handlers or externally triggered jobs. Use to turn a small program into a hosted Function, inspect logs and verify its execution result. Requires the customer's Functions execution permission.
---

Functions is a separate service for individual code executions. Firecracker VPS is a persistent Linux server for websites, applications and systems; use the deployment or troubleshooting skill for work inside that server.

Read the connected account and `list_functions` for existing functions, current runtimes and limits. Read an existing function before editing. Functions permissions cover the account, independently of selected VPS servers. Follow [execution and recovery](../vpsnet-operations/references/execution.md).

Choose a supported runtime, minimal suitable resources and a bounded timeout. Write or update the requested code and validate its expected input/output. Reuse a stable `idempotency_key` when creating a function so a lost response does not create another one. Enable public webhook exposure only when requested; scheduling requires an external trigger.

Environment values are redacted in OAuth reads. Omit `environment` during unrelated edits to preserve it; never copy `[REDACTED]` back as a secret value. Have the customer enter credentials through VPSnet's secure settings. Avoid printing existing secret-bearing output unnecessarily.

Before execution, establish the user's agreement to usage charges and an explicit daily ceiling through the OAuth Functions execution permission. The ceiling counts total account Functions usage, including pending runs; reconnecting does not replenish it. Managing definitions alone does not grant execution. If a cap, balance or permission prevents a run, explain that state without initiating a purchase or changing the payer.

Invoke with `acknowledge_usage_billing: true`, one stable `idempotency_key`, and `wait: true` when output is needed. Read the returned `invocation_uuid` and use it with `get_function_invocation` to check the final status, exit code and retained output. Asynchronous invocations (`wait: false`) retain status and usage, but no output. Retry uncertain requests with the same key and payload. Failures can consume usage too. Validate the actual output against the user's requested result; creating a definition or receiving a queued receipt is not completion.
