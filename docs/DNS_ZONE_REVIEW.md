# DNS create: review correction — 2026-10-30

The supplied OpenAI finding only says this new tool needs further review. It does
not identify a violated rule. The fixes below follow the actual backend and
published requirements; no specific scanner cause or approval is claimed.

## Verified behavior and correction

Backend evidence is pinned to `vpsnet_backend` commit
`4b6ee7bfd0b1be720a0b0d40c6e948e00a511cbd`:

- `DnsZonesController::store` normally creates pending verification, but lines
  272–287 can immediately restore/publish via guarded prior ownership.
  `PendingZoneVerificationService::priorOwnership` requires current registrar
  ownership, recent eligible history and no contested claim; this is not an
  ownership bypass. Publication is queued, not proven applied by a create result.
- `PendingZoneVerificationService::publish` calls `deleteStaleCandidates` at
  line899. Lines1083–1109 delete stale candidates, records and DDNS tokens. A
  same-account failed candidate is not blocked by the create duplicate guard.
  Therefore `destructiveHint: true` is required even for native-only creation.
  Existing live zones are refused. The operation does not register a domain or
  change registrar nameservers.
- Secondary creation requests a raw TSIG authentication secret. Backend
  encryption and omission from normal responses/audit payloads do not remove it
  from model arguments. Hosted directory and orders profiles now accept only
  native zones, and strictly reject old secret/secondary inputs before API
  dispatch. Local stdio's private-client contract is unchanged.

The public TXT ownership challenge is intended to be published in DNS. It is not
the TSIG authentication secret. Its retrieval/rotation flow remains available.

OpenAI's [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
restrict collection of authentication secrets and require descriptions/annotations
to reflect actual effects. Its [review guidance](https://developers.openai.com/plugins/deploy/app-review)
explains that scans import server metadata; editing a portal justification cannot
override server behavior. Neither document establishes why this specific tool
was held. No unnecessary output-schema or title change is made.

## Compatibility and release

This is a prepared source correction. No hosted deployment, npm release, portal
rescan or publication is performed by this change. OpenAI and Claude share the
directory profile; the restriction is not selected by reviewer or user agent.

Before rollout, compare the live/approved definitions in each supported client.
The user-supplied OpenAI definition is unpublished; that does not establish other
clients' cached state. Coordinate a schema refresh for hosted clients. Old
secondary/TSIG calls will be refused intentionally, never executed as a different
operation. Direct those users to the existing authenticated DNS panel. Do not
claim an approved definition changed until the live endpoint and portal confirm
it. Local stdio remains available under its existing credentials and semantics.

After deployment, capture `tools/list`, verify the native-only strict schema and
three effect hints, then rescan the existing draft where the portal permits it.
If the generic hold remains, request a specific rule/finding from OpenAI support
with the submission ID. Do not fabricate a justification or repeatedly change
labels/versions to evade the hold.

## Future hosted secondary support

To support hosted secondary creation without raw authentication secrets, provide
a preconfigured credential reference resolved and authorized within the account.
Validate the backend key-ownership boundary as part of that work. This MCP change
does not implement the credential-reference API or change panel/local behavior.

## Local verification

`test/dns-zone-create-contract.test.mjs` exercises actual SDK/HTTP dispatch for
both hosted profiles, rejects cached secret/secondary fields before backend
mutation, retains OAuth scope checks and pending/published responses, and checks
local stdio secondary compatibility. All credentials and DNS names are synthetic;
the backend is loopback-only. Contract snapshots and an independent effect-policy
case document the intentional change. These checks do not reproduce OpenAI's
private scanner or prove a production rollout.
