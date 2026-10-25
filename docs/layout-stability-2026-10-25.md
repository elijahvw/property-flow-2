# Layout stability investigation — October 25, 2026

Parent-reported observations from a Grafana snapshot describe high layout-shift readings on company/platform detail, user, property and tenant screens. The original Library image could not be materialized in this executor, so those observations are secondary context. The generic platform detail family is modeled here with the canonical company-detail route as a candidate; its literal historical route was not independently verified. This small historical sample does not establish which element moved, whether current code reproduces it, or which change would help. Zero reported JavaScript/action errors also does not prove a stable layout.

## Matched local measurement

`scripts/measure-layout-stability.mjs` measures four canonical route types with explicitly fictional API fixtures: company detail, platform users, property detail and tenant directory. Every API call is intercepted, and unexpected external traffic is blocked. It does not access customer/provider APIs or change Grafana, production telemetry or replay configuration.

Compare a built merged-source baseline with the built current client using identical arguments. The default experiment uses three cold-context visits per route at 1440×1000 and 390×844, with 200ms bootstrap and 800ms record delays. There is no user interaction during a visit. Routing disables the browser HTTP cache for both sources. The observer is installed before application execution; it excludes entries marked `hadRecentInput` and reports the maximum session-window sum (less than one second between entries, less than five seconds from the first entry), separately from the sum across the entire visit.

Example (replace the loopback port and label for each source):

```sh
node scripts/measure-layout-stability.mjs \
  --base-url http://127.0.0.1:5092 \
  --label merged47 \
  --out /tmp/layout-baseline.json \
  --runs 3 \
  --chromium /usr/bin/chromium
```

The report contains static route categories, timings, allowlisted structural element paths and numeric rectangles. It excludes DOM text, record identifiers, contact fields and URLs. Optional screenshots contain only these fictional fixtures and belong outside Git. This is a local diagnostic, not an extension of production RUM data collection.

## Evidence and limits

The first matched production-build smoke completed all eight route/viewport combinations for each source without page errors, failed scenarios or horizontal overflow. This was one repetition per combination, so it is diagnostic evidence rather than the final three-run comparison.

| Route | Merged baseline desktop CLS | Overhaul before stability fix desktop CLS | Baseline mobile CLS | Overhaul before stability fix mobile CLS |
| --- | ---: | ---: | ---: | ---: |
| Company detail | 0.04852 | 0.04455 | 0 | 0 |
| Users | 0.17848 | 0.19935 | 0.15367 | 0.00905 |
| Property detail | 0.02738 | 0.02529 | 0 | 0 |
| Tenants | 0.11855 | 0.06744 | 0 | 0 |

The Users desktop trace identified a concrete source: the following Invitations panel moved from `(272,710,1140,290)` to outside the viewport immediately after the delayed user/sync responses, contributing 0.1852 of the visit’s 0.19935 CLS. The Users results initially occupied only a loading line, then expanded into a table. A separate conditional sync announcement disappeared when synchronization completed. The trace establishes these local mechanisms; it does not explain the larger historical Grafana values.

The targeted change reserves a bounded 24rem desktop results area across loading, loaded, empty and failed states and uses decorative loading rows while the read is pending. The sync announcement keeps one line within the existing result summary. The minimum is removed at mobile widths because the new mobile layout already measured 0.00905 and a large empty mobile well would add unnecessary scrolling. The desktop empty/error view deliberately retains some whitespace so following content does not jump back upward. Placeholder shapes are hidden from assistive technology; the actual loading label remains a status announcement. No count, record, access decision or API response is invented by the placeholder.

## Matched three-run comparison at `overhaul-stable`

Both production builds ran three cold-context visits for every route/viewport combination using Chromium `154.0.8037.57` and the same fixture delays/settings. All 24 current-client visits completed with zero page errors, failed scenarios or horizontal-overflow observations and passed the scoped CLS ≤0.1 gate. All 24 baseline visits also completed; the baseline was collected without enforcing that gate.

Values below are median CLS with the observed minimum–maximum in parentheses, rounded to six decimals. The [sanitized structural evidence](acceptance-evidence/layout-stability-2026-10-25.json) retains the full numeric precision, every repetition, source rectangles/timings and the diagnostic pre-fix smoke.

| Route / viewport | Merged baseline | Current with stability fix |
| --- | ---: | ---: |
| Company detail / desktop | 0.048516 (0.048516–0.048516) | 0.053355 (0.053355–0.053355) |
| Company detail / mobile | 0 (0–0) | 0 (0–0) |
| Users / desktop | 0.182664 (0.182664–0.182664) | 0.036801 (0.036801–0.036804) |
| Users / mobile | 0.145741 (0.145741–0.145741) | 0.009048 (0.009048–0.009048) |
| Property detail / desktop | 0.027379 (0.027379–0.027379) | 0.048239 (0.048239–0.048239) |
| Property detail / mobile | 0 (0–0) | 0 (0–0) |
| Tenants / desktop | 0.137887 (0.137754–0.137887) | 0.076594 (0.067442–0.076594) |
| Tenants / mobile | 0 (0–0) | 0 (0–0) |

Users improved at both sizes, and Tenants improved on desktop. Company and property detail desktop CLS increased compared with the merged baseline while remaining below this experiment’s 0.1 budget. The change therefore does not establish that every screen improved. The isolated Users loading fix addressed its observed Invitations-panel displacement; the comparison includes the broader interface overhaul as well.

The harness passes `node --check`; the updated client passes TypeScript checking. The focused metrics test covers recent-input exclusion, maximum-session rather than whole-visit sums, the exact one-second gap, sub-millisecond boundaries and the five-second cap. The harness also rechecks that the expected page heading remains visible after settling and rejects the error-boundary screen; an early heading alone cannot produce a passing measurement. Pass `--budget 0.1` to enforce the current-client scenario budget; omit it when collecting a baseline that is known to exceed it.

These results identify the locally built `overhaul-stable` source stage, not a deployment or blanket validation of subsequent edits. The original comparison and raw observations remain in the evidence artifact; the following current-only recheck covers the later shell change without replacing that baseline comparison.

## Prior final-shell budget recheck

After the final shell build, the current client was measured again as `overhaul-final-shell`: three visits to all eight route/viewport combinations, using the identical browser, fixture delays, cold contexts and other configuration. All 24 visits passed CLS ≤0.1, with zero page errors, failed scenarios or horizontal overflow. The original baseline was unchanged and was reused.

| Route / viewport | Median CLS | Observed minimum–maximum |
| --- | ---: | ---: |
| Company detail / desktop | 0.053355 | 0.044553–0.053355 |
| Company detail / mobile | 0 | 0–0 |
| Users / desktop | 0.026189 | 0.026186–0.026189 |
| Users / mobile | 0.008914 | 0.008914–0.008914 |
| Property detail / desktop | 0.048239 | 0.048239–0.048239 |
| Property detail / mobile | 0 | 0–0 |
| Tenants / desktop | 0.067442 | 0.052474–0.067442 |
| Tenants / mobile | 0 | 0–0 |

This recheck ran alongside single-worker leasing browser fixtures, with no concurrent Docker lifecycle. CPU/browser scheduling was shared; differences from the prior stage must not be attributed solely to the mobile header change. The final shell reserves its mobile control row before restoration, but the experiment does not isolate that change's individual performance effect. Company/property desktop medians still exceed their original baseline values while remaining within the scoped budget.

The evidence artifact preserves the baseline, pre-fix diagnostic smoke, first matched current stage and final source recheck, including all structural observations. Repeat affected scenarios after geometry, loading, shell, permission projection or related content changes; other financial/demo changes retain their separate functional checks. Neither build is a deployed or user-accepted release.

## Final guard-build budget recheck

After the passing454-case aggregate, the unchanged current build was measured as `overhaul-final-guard`, using the same browser/configuration, three visits per route/viewport and 0.1 budget. This quiet recheck had no other browser suite or Docker lifecycle in flight. All 24 visits passed, with zero page errors, failed visits or horizontal overflow. The final source digest is recorded with its structural results in the evidence artifact; no baseline was replaced.

| Route / viewport | Median CLS | Observed minimum–maximum |
| --- | ---: | ---: |
| Company / desktop | 0.053355 | 0.053355–0.053355 |
| Company / mobile | 0 | 0–0 |
| Users / desktop | 0.036804 | 0.036801–0.036804 |
| Users / mobile | 0.008914 | 0.008914–0.008914 |
| Property / desktop | 0.048239 | 0.048239–0.048239 |
| Property / mobile | 0 | 0–0 |
| Tenants / desktop | 0.067442 | 0.067442–0.076594 |
| Tenants / mobile | 0 | 0–0 |

The original matched comparison still determines before/after claims. Small differences among current-only stages reflect observed scheduling as well as code changes; the final guard change was functional, and this recheck does not attribute a performance gain to it. Company/property desktop values remain above the original baseline while inside budget.

For a changed route under this fixed scenario, target CLS ≤0.1 at both tested sizes and record every repetition. A passing local budget does not establish field Core Web Vitals, a percentile across real users, or behavior with longer text, different devices, network loss or additional late content. Continue with the normal workflow/accessibility checks and hosted monitoring acceptance separately.

The navigation TTFB recorded here belongs to the loopback static document. The harness intercepts API responses and does not measure the reported historic lease-detail TTFB, database latency or provider timing. No historical image cause or lease-performance diagnosis is claimed, and production Grafana/replay/privacy settings remain unchanged.
