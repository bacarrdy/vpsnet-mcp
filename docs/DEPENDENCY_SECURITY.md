# Production dependency security update

Reviewed 2026-11-09 against VPN candidate `d3d3d9fa1b097780e3530f49e67470a289455d85`.
This source update is not a deployment or registry publication.

The MCP SDK remains **1.32.1**. The lock updates only the six affected packages and
the `content-type` / `iconv-lite` versions required by patched body-parser:

| Package | Previous | Updated | Applicability to this server |
| --- | --- | --- | --- |
| Zod | 3.25.76 | 4.6.7 | Tools validate caller-controlled collections. The old bounded-array parser still traversed every element and accumulated errors before rejecting excess length. |
| body-parser | 2.3.0 | 2.4.0 | Installed through SDK → Express. The hosted entry point uses Node HTTP, authenticates first, reads at most 1 MiB, parses JSON itself and supplies the parsed body to the SDK. It does not install body-parser middleware or decompress request bodies. |
| @hono/node-server | 2.0.12 | 2.1.3 | The SDK uses its HTTP request adapter. This application does not use the affected `serveStatic` feature. |
| fast-uri | 3.1.8 | 3.1.9 | Installed through SDK → AJV for JSON Schema processing. No application URL allowlist or redirect uses its normalization/equality functions. No exploitable caller-controlled path was established for these advisories. |
| ip-address | 10.7.2 | 10.7.4 | Installed through SDK → express-rate-limit. This application's Node HTTP entry point does not install the Express rate limiter. |
| qs | 6.16.0 | 6.16.1 | Installed through Express/body-parser. No application call uses the affected comma-array stringify option. |

The transitive updates satisfy the existing parent dependency ranges; there are no
new overrides or direct transitive dependencies. Zod is the necessary major
upgrade: upstream has no patched v3 release, and using `zod/v3` from the new package
would retain the vulnerable parser. All application validators import the v4
package entry point. The unchanged SDK still ships a v3 compatibility branch;
the registry regression test checks that all actual input/output tool validators,
including cached aliases, select v4.

## Compatibility

Tool names, routes, handlers, scopes, purchase authorization and catalogue counts
remain unchanged. The migration preserves previous UUID layout validation with
`guid()`, without introducing version/variant restrictions. Previously unbounded
integer fields retain their original range using a v4 integer refinement;
explicit safe-integer constraints remain. The bounded source-IP allowlist retains
its prior IPv6 syntax, including scoped link-local values; the backend still
decides eligibility. Record schemas explicitly declare their existing string keys.

The existing bounded schema presenter retains the previously advertised
`additionalProperties: false` for nonempty object inputs. The reviewed fixture
changes otherwise reflect v4 generation: explicit format regexes, string-key
metadata, literal unions instead of enums, discriminated `oneOf` unions,
equivalent permissive catchalls (`{}` instead of `true`), description inheritance,
and an expanded output reference. These changes do not add a tool or grant access.

The security regression verifies that oversized bounded arrays produce one size
issue without walking their elements. Through the real local HTTP server, it also
checks that compressed data with trailing bytes is rejected, an oversized tool
collection never reaches the mocked customer API, and subsequent discovery still
works. Upstream's fix does **not** impose new limits on unbounded collections;
the existing HTTP size bound remains relevant. Tests use local fixtures only.

## Primary sources

- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [upstream fix](https://github.com/colinhacks/zod/pull/6652), [unpatched v3 report](https://github.com/colinhacks/zod/issues/6653).
- [body-parser maintainer advisory](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828).
- [Hono node-server maintainer advisory](https://github.com/honojs/node-server/security/advisories/GHSA-rmxm-3fg6-px4f).
- fast-uri maintainer advisories: [encoded scheme](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg), [relative paths](https://github.com/fastify/fast-uri/security/advisories/GHSA-xhq7-xmqj-769h), [host canonicalization](https://github.com/fastify/fast-uri/security/advisories/GHSA-wjr9-j795-jxcr), [suffix scheme injection](https://github.com/fastify/fast-uri/security/advisories/GHSA-333x-w4r6-6crp).
- [ip-address maintainer advisory](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-rxp7-6hxx-x8q5).
- [qs maintainer advisory](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw).
