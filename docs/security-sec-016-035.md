# Dependency security review: SEC-016–SEC-035

Reviewed on 2026-11-01. These are the next 20 pending scanner records after the
previous two blocks. Existing local fixes are retained; all work remains
uncommitted.

| Finding | Trigger | Installed path and application reachability | Remediation |
| --- | --- | --- | --- |
| [SEC-016](https://github.com/browserslist/browserslist/security/advisories/GHSA-73wf-gq98-2v4g) | Custom stats keys crash normalization or write a result prototype. | Babel/webpack development tooling in both projects; no untrusted stats file or request-supplied query. | Browserslist 4.28.6 → 4.29.5 |
| [SEC-017](https://github.com/browserslist/browserslist/security/advisories/GHSA-c83g-rgw3-j3cx) | Distinct query results remain cached indefinitely. | Same tooling paths; the application does not run varying user queries through Browserslist. | Same update; verify eviction and recomputation |
| [SEC-018](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) | Matching cyclic records recurse until stack exhaustion. | Prisma 6.19.3 → @prisma/config 6.19.3; local CLI configuration, not HTTP input. Plain JSON cannot create cycles. | Scoped deepmerge-ts 7.1.5 → 8.0.2 override |
| [SEC-019](https://github.com/socketio/socket.io/security/advisories/GHSA-2gc4-cqfq-p2gv) | An upgrade can choose a different Engine.IO revision from its polling session. | Runtime socket.io 4.8.3 → engine.io 6.6.9; default server upgrades run before Socket.IO JWT handling. | Engine.IO 6.6.9 → 6.6.11 within ~6.6.0 |
| [SEC-020](https://github.com/fastify/fast-uri/security/advisories/GHSA-5jgf-p345-68v8) | Scheme-relative IDN host is not canonicalized after resolution. | AJV through Nest CLI/schematics and webpack schema-utils; no application host-policy or outbound HTTP path uses fast-uri. | fast-uri 3.1.3 → 3.1.9 within existing 3.x ranges |
| [SEC-021](https://github.com/fastify/fast-uri/security/advisories/GHSA-7p8r-x3mc-p8w7) | Backslash authority prefixes disagree with WHATWG URL parsing. | Same fast-uri tooling paths. | Same fast-uri patch |
| [SEC-022](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc) | Malformed IPv6 literals normalize into valid private addresses. | Same fast-uri tooling paths. | Same fast-uri patch |
| [SEC-023](https://github.com/fastify/fast-uri/security/advisories/GHSA-fph4-wmhf-6fwf) | Repeated host decoding turns nested escapes into a live destination. | Same fast-uri tooling paths. | Same fast-uri patch |
| [SEC-024](https://github.com/fastify/fast-uri/security/advisories/GHSA-jqff-g426-hqxp) | Encoded scheme delimiters introduce an authority or raw controls. | Same fast-uri tooling paths. | Same fast-uri patch |
| [SEC-025](https://github.com/fastify/fast-uri/security/advisories/GHSA-qw65-cvwx-89v3) | An unvalidated serialized port injects authority delimiters. | Same fast-uri tooling paths. | Same fast-uri patch |
| [SEC-026](https://github.com/fastify/fast-uri/security/advisories/GHSA-v2hh-gcrm-f6hx) | A literal backslash changes the authority seen by WHATWG URL. | Same fast-uri tooling paths. | Same fast-uri patch |
| [SEC-027](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-8r9p-f939-6h3c) | Regex metacharacters prevent stripping declared sensitive headers. | Frontend Axios → follow-redirects Node adapter; this application uses browser adapters, with no SSR. | follow-redirects 1.16.0 → 1.16.2 within ^1.16.0 |
| [SEC-028](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-mrwp-f3q8-3g9p) | Cross-realm sensitiveHeaders arrays are silently discarded. | Same Node-only redirect path. | Same follow-redirects patch |
| [SEC-029](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-q3jh-wrc6-jgq8) | Array-form headers bypass cross-origin credential stripping. | Same Node-only redirect path. | Same follow-redirects patch |
| [SEC-030](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh) | Merging repeated empty mappings bypasses the CPU budget. | ESLint/cosmiconfig and backend NYC tooling load configuration YAML; no API accepts YAML. | js-yaml 3.15.0 → 3.15.2 and 4.3.0 → 4.3.2 |
| [SEC-031](https://github.com/nodeca/js-yaml/security/advisories/GHSA-5p4m-2wfm-xmqj) | Ordered-map key uniqueness uses quadratic linear scans. | Same YAML tooling paths; both installed major lines are affected. | Same js-yaml backports; do not move to 5.x |
| [SEC-032](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4) | A sparse array index followed by an object key causes a synchronous stall. | Multer is installed by the Nest adapter, but no upload interceptor or multipart middleware is registered. The patched API still needs an explicit index limit when used. | Multer 2.2.0 → 2.5.0; validate fieldArrayIndexLimit: 1000 in an isolated integration |
| [SEC-033](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m) | A pending async fileFilter resumes a parser after teardown. | No application upload routes, async fileFilter or disk storage configuration. | Scoped Multer 2.5.0 override under the compatible Nest adapter |
| [SEC-034](https://github.com/expressjs/multer/security/advisories/GHSA-qfvm-cv95-jqjf) | Aborted disk uploads retain open deleted-file descriptors. | Same unused upload path. | Same Multer update; verify zero retained descriptors |
| [SEC-035](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm) | Crafted field names push beyond the maximum array length. | Same unused upload path. | Same Multer update; verify handled field errors |

## Compatibility decisions

Most changes stay within the existing parent ranges. Browserslist also refreshes
its browser datasets; its new query-continuation syntax does not change any
application-supplied query. Engine.IO retains its valid v4 upgrade path. JS-YAML
receives the maintained 3.x and 4.x backports rather than a 5.x migration. Fast-uri
stays on 3.x, including fixes for its other already tracked normalization issues.

Two exact upstream pins require scoped npm overrides in backend/package.json:

- `@prisma/config@6.19.3 → deepmerge-ts@8.0.2`: Prisma 6 has no newer published
  version and npm audit otherwise proposes a Prisma 7 migration. The
  [deepmerge-ts 8 release](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)
  changes Map value merging, metadata type names and deepmergeInto mutation.
  Prisma's compiled config loader imports only `deepmerge` as the c12 merger;
  its supported project configuration uses plain records, arrays, strings and
  functions. It does not use those changed Map/type/into APIs. The CommonJS and
  ESM exports and Node engine support were checked. Six config/merge fixtures
  compare behavior with 7.1.5; Prisma generation and isolated database commands
  validate the actual project CLI usage. Keep Prisma and its client at 6.19.3.
- `@nestjs/platform-express → multer@2.5.0`: the adapter still pins 2.4.0, which
  leaves SEC-033 open. The adapter itself is updated from 11.1.28 to 11.2.8,
  with a declared minimum of ^11.2.8, while core/common/testing stay unchanged.
  Their peer ranges allow the same 11.x versions. This targeted adapter update
  is necessary because the old adapter matches Multer error messages and turns
  the new unexpected-file message into HTTP 500. The
  [Nest 11.2.6 backport](https://github.com/nestjs/nest/releases/tag/v11.2.6),
  included in 11.2.8, maps stable error codes and restores HTTP 400. An isolated
  FileInterceptor fixture checks real upload bytes and HTTP error behavior.

Review and remove these overrides when their parents accept the secure versions
natively. Re-check the reviewed parent versions and contracts on future updates.
Neither override is a general statement that every consumer of the newer major
has identical behavior.

## SEC-032 configuration requirement

Multer 2.5.0 does **not** impose an array-index limit by default. The upstream
advisory requires callers to set `limits.fieldArrayIndexLimit`. A controlled
unbounded-default probe still stalled and was killed; that evidence is retained.
The bounded probe uses `fieldArrayIndexLimit: 1000` and rejects the hostile field
before array conversion. The Nest integration fixture uses the same explicit
limit and verifies the resulting HTTP 400 response.

This exchange has no multipart/upload routes or Multer interceptors, so attacker
input does not reach that parser. Real API checks verify rejection of the crafted
multipart login requests while health remains available. Any future upload
feature must explicitly set an appropriate array-index limit and nesting limit;
installing this version alone does not satisfy that future configuration duty.
No unused upload endpoint or middleware is introduced merely to configure it.

## Verification and audit

Clean installs, Prisma generation, backend/frontend lint, type checks and builds
passed. All 778 existing automated tests passed: 413 backend unit tests, 13 runner
tests, 293 isolated PostgreSQL/Redis E2E tests, 57 frontend tests and two Chromium
journeys. After the adapter compatibility finding, backend checks and Chromium
were repeated against the final adapter version.

Dedicated checks passed as well:

- 22 advisory probes cover all 20 targets, with both installed JS-YAML lines
  checked separately. They test cache eviction, recursive graph handling,
  protocol consistency, URI interpretation, redirect credential stripping,
  YAML budgets and ordered maps, multipart field bounds and upload cleanup.
  Test credentials are fictitious and network listeners are loopback-only.
  The unbounded SEC-032 default and the explicitly bounded case are recorded
  separately rather than treating the default as safe.
- Six Prisma config/merge fixtures retain identical before/after results.
- Five real Nest FileInterceptor fixtures pass: upload bytes and fields (201),
  unexpected file (400), file size (413), fields without a file (201) and an
  explicitly bounded field index (400).
- After automation, 34 manual scenarios pass using production artifacts and
  disposable infrastructure: the 20 exchange/recovery scenarios, nine HTTP
  regressions and five Engine.IO/multipart checks. The real API accepts a valid
  v4 probe, rejects v3 and omitted-version upgrades with HTTP 400, rejects the
  unregistered multipart login inputs with HTTP 400, and stays healthy throughout.

No new or recurring functional defect was confirmed in the final application.
All disposable processes, containers and networks were removed; no development
database or Redis instance was used. Local validation used Node 22.14.0 and npm
10.9.2; the README still recommends Node 22.20.0.

This block removes 28 distinct advisories: SEC-016–SEC-035 plus SEC-055,
SEC-058–SEC-060, SEC-064 and SEC-089–SEC-091 through shared dependencies. The
eight additional findings were checked by advisory URL, without a separate
application exploitability triage. The audit changes from 70 to 42 distinct
advisories, with no new finding; package-level counts change from 44 to 34 in
the backend and 30 to 26 in the frontend. Across all local security changes,
the original 95 advisories are now 42. Remaining scanner records still need
their own investigation.
