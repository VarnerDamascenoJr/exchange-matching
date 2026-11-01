# Dependency security review: SEC-001–SEC-005

Reviewed on 2026-11-01. These scanner findings concern vulnerable dependency
versions; the application paths below do not establish an exploitable deployment.

| Finding | Dependency path before remediation | Applicability in this project | Remediation |
| --- | --- | --- | --- |
| [SEC-001: AST type confusion](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-8r5x-fm3f-whwj) | Backend dev dependency `ts-jest@29.4.11 → handlebars@4.7.9` | Requires an untrusted AST passed to `compile`/`precompile`. The application's API and worker do not use Handlebars. The ts-jest configuration initializer compiles a fixed template string. | Lock Handlebars to `4.7.10`, allowed by ts-jest's existing `^4.7.9` range. |
| [SEC-002: own-property check bypass](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-p8wg-vrv2-v86f) | Same Handlebars dev dependency | Requires attacker-controlled templates and permissive prototype method access. Neither is configured here. | Same Handlebars patch. |
| [SEC-003: proxy trust subnet spoofing](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h) | Backend `@nestjs/platform-express@11.1.28 → express@5.2.1 → proxy-addr@2.0.7` | Runtime dependency, but the application leaves Express `trust proxy` disabled and does not use forwarded IPs for authorization. The advisory requires an affected IPv6 trust subnet. | Lock proxy-addr to `2.0.8`, allowed by Express's existing `^2.0.7` range. |
| [SEC-004: HTTP/2 DNS/proxy policy bypass](https://github.com/axios/axios/security/advisories/GHSA-3pq3-5fj3-cg6v) | Frontend direct dependency `axios@1.18.1` | Requires the Node HTTP adapter with `httpVersion: 2` and DNS/proxy policy controls. This React application uses browser requests to its configured API; it has no SSR or Axios HTTP/2 configuration. | Raise the declared minimum to `^1.20.0` and lock Axios to `1.20.0`. |
| [SEC-005: unhandled HTTP/2 session error](https://github.com/axios/axios/security/advisories/GHSA-542g-h47m-68v8) | Same Axios dependency | Requires Node HTTP/2 session creation. Browser adapters are outside this advisory's affected path. | Same Axios update. |

## Compatibility and scope

Only three installed package versions change. No framework upgrade, dependency
override, or forced audit fix is needed. Existing lockfile entries already satisfy
the patched packages' updated minimums for minimist and form-data.

The upstream release notes were reviewed for
[Handlebars 4.7.10](https://github.com/handlebars-lang/handlebars.js/releases/tag/v4.7.10),
[proxy-addr 2.0.8](https://github.com/jshttp/proxy-addr/releases/tag/v2.0.8), and
[Axios 1.20.0](https://github.com/axios/axios/releases/tag/v1.20.0).
Handlebars changes lazy iterable rendering, but the ts-jest initializer renders
plain configuration data. Axios hardens inherited options and interceptor objects;
the application's interceptor returns its supplied config and uses the public
headers API. Its new HTTP status names retain the old aliases. No application
change is required for these compatibility notes.

## Verification

Controlled local probes reproduced all five dependency defects before updating:
an AST executed a harmless marker, a template exposed `Function`, a malformed
proxy trust subnet accepted an unrelated IPv4 address, HTTP/2 bypassed a rejecting
DNS policy, and a failed HTTP/2 connection terminated a child process.
The same probes reject those behaviors with the patched versions. Valid IPv4
and IPv4-mapped subnet controls continue to work.

Fresh `npm audit --json` runs report 79 distinct advisories, down from 95, with no
new advisory. All five findings above are absent. The shared updates also remove
the other ten Axios advisories and the Handlebars precompiled-template advisory
GHSA-xw65-4hp5-5hc7. Package-level audit counts change from 49 to 47 in the backend
and from 32 to 31 in the frontend; these counts differ from distinct advisories.
Remaining findings require separate triage.

Clean installs, lint, type checks and production builds passed on Node 22.14.0
and npm 10.9.2. The existing 778 automated tests passed: 413 backend unit tests,
13 runner tests, 293 isolated database E2E tests, 57 frontend tests and two
Chromium journeys. Automated checks preceded 20 manual scenarios against
disposable PostgreSQL/Redis and production API/worker/frontend artifacts,
including partial settlement, fees, concurrent reservations, cancellation,
pagination, mobile layout, invalid sessions, per-fill rounding and Redis recovery.
No new or recurring functional defect was confirmed. The README's recommended
Node version remains 22.20.0.
