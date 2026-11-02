# Dependency security review: SEC-011–SEC-015

Reviewed on 2026-11-01, after the SEC-001–SEC-005 changes. This block updates
transitive dependencies within their existing parent ranges.

| Finding | Installed dependency and applicability | Remediation |
| --- | --- | --- |
| [SEC-011: compressed request trailing bytes](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828) | Backend `@nestjs/platform-express@11.1.28 → express@5.2.1 → body-parser@2.3.0`. Nest registers the default JSON and URL-encoded parsers before routes; decompression is enabled. An unauthenticated compressed body can reach this path even without a matching route. A controlled Express child process reproduced the uncaught decompressor error. | Resolve `body-parser@2.4.0` within Express's `^2.2.1` range. Preserve compressed-body support. |
| [SEC-012: comma-part parser stack exhaustion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p) | `brace-expansion` through minimatch/glob in lint, Jest, the Nest CLI and TypeScript ESLint. A long pattern with many comma-separated brace groups overflows the parser stack. No application request or queue input is passed to these tools. | Update every installed copy on its existing major line. |
| [SEC-013: unbounded expansion length](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-mh99-v99m-4gvg) | Same development dependency paths. Limiting result count alone does not bound the combined character length of chained expansions. | Same updates; verify the character bound with a small explicit limit. |
| [SEC-014: nested brace stack exhaustion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7) | Same paths. Deep nesting reaches recursion not covered by the earlier tail and comma-parser fixes. | Same updates; verify nested patterns and ordinary expansion. |
| [SEC-015: intermediate expansion arrays](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-rgw5-rvv9-x895) | Same paths. Intermediate alternatives and padded sequences can exceed the earlier length mitigation before results are combined. | Same updates; verify bounded alternatives in disposable child processes. |

## Version selection and compatibility

- `brace-expansion` moves from `1.1.16 → 1.1.21`, `2.1.2 → 2.1.7` and
  `5.0.7 → 5.0.12`. Existing minimatch ranges are `^1.1.7`, `^2.0.2` and
  `^5.0.5`, respectively. Both projects retain their existing tooling versions.
- These patch releases also address the already tracked
  [SEC-056 quadratic parser rewrite](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr).
  Earlier patches for the four target advisories would leave that finding open.
- The CommonJS/ESM entrypoints and dependencies remain the same. Version 5 now
  requires Node `20 || >=22`, compatible with the project's documented Node 22
  requirement. Node 18 is not a supported project target.
- [body-parser 2.4.0](https://github.com/expressjs/body-parser/releases/tag/v2.4.0)
  requires `content-type@^2.1.0` and `qs@^6.16.1`; npm resolves them to `2.1.0`
  and `6.17.1`. These are required transitive updates, not new direct dependencies.
  The [qs changelog](https://github.com/ljharb/qs/blob/v6.17.1/CHANGELOG.md) was
  reviewed for parser and array-limit changes. The additional content-type comma
  parsing behavior is opt-in. Body-parser's optional Zstandard path checks runtime
  support; Node 22.14.0 lacks it and keeps returning HTTP 415 for that encoding.
- No framework, minimatch or glob version changes, overrides or forced audit
  fixes are needed. The earlier Handlebars, proxy-addr and Axios fixes are retained.

## Verification

Clean installs, Prisma generation, lint, types and production builds passed.
All 778 existing automated tests passed again: 413 backend unit, 13 runner,
293 isolated database E2E, 57 frontend and two Chromium journeys.

Thirteen controlled security probes passed: the compressed-body process probe
and the four brace-expansion checks on each of the three installed version lines.
Before updating, the body parser child crashed, both recursive pattern classes
exhausted the stack, the explicit character bound was exceeded, and intermediate
alternatives exhausted the child heaps. After updating, normal patterns still
expand correctly, character limits hold, nested inputs return without stack
failure, intermediate results stay bounded and compressed trailing bytes no
longer terminate the child. Heap limits and disabled core dumps confined those
intentional failures to disposable processes.

After automation, 29 manual scenarios passed against disposable infrastructure:
the 20 exchange flows, production commands and recovery checks, plus nine HTTP
checks for gzip/deflate login, trailing bytes on unauthenticated missing routes,
invalid compression, decompressed size limits, unsupported encoding and valid
or invalid URL-encoded login bodies. The API stayed healthy after every HTTP
probe. No new or recurring functional defect was confirmed.

Audits remove nine distinct advisories in this block: SEC-011–SEC-015, SEC-056
and SEC-066–SEC-068. The three qs findings disappear through the body-parser
dependency requirement; their application exploitability was not independently
triaged here. Counts fall from 79 to 70 distinct advisories, with no new finding;
package-level counts fall from 47 to 44 in the backend and from 31 to 30 in the
frontend. Across both blocks, the original 95 advisories are now 70.

Local validation used Node 22.14.0 and npm 10.9.2; the README recommends Node
22.20.0. Both security blocks remain uncommitted local changes.
