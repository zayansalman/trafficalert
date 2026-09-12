# Parallel execution plan

Tracking issue: [#20](https://github.com/zayansalman/trafficalert/issues/20)

Every "depends on" line in the issue tracker is a **type** dependency, not a **behaviour**
dependency. One commit ([#17](https://github.com/zayansalman/trafficalert/issues/17)) that freezes
the types below converts a serial chain into six parallel tracks.

**Rule for the whole project: no worker imports another worker's implementation — only these types.**

Critical path: #17 → #10 → #15 → #9 → #18 → #1.

## ADR-001 — LLM provider: OpenAI (DECIDED)

Ruled by the repo owner. Data digestion and the chat layer both run on the OpenAI API key.
#9's body still says "Claude API" and must be rescoped; its tool names
(`query_congestion`, `get_route`, `submit_report`) and tool-use semantics are unaffected —
OpenAI function calling expresses all three identically.

The provider stays behind `lib/llm/client.ts` exposing `stream(messages, tools)`, with tool
definitions as provider-neutral JSON schema. That adapter is not made redundant by this ruling:
it is what kept twelve issues unblocked while the question was open, and it keeps a future
change to one file.

---

## Tracks

| Track | Name | Issues | Label |
|---|---|---|---|
| T1 | Foundation, Contracts & Deploy | #17, #7 | `track:1-foundation` |
| T2 | Conversation Layer | #8, #9, #19 | `track:2-conversation` |
| T3 | Congestion Core | #11, #13, #14, #16 | `track:3-congestion-core` |
| T4 | Routing & Geo | #10, #15 | `track:4-routing-geo` |
| T5 | Reports & User State | #12, #6 | `track:5-reports-identity` |
| T6 | Story, Demo & Proof | #4, #18, #1 | `track:6-story-demo` |

## File ownership

| File | Sole owner | Amendment rule |
|---|---|---|
| `types/congestion.ts` | T1 (hour-zero) | Additive only. Breaking changes need 2 approvals and a ping to #11/#12/#13/#14/#15/#16 |
| `types/routing.ts` | T1 (hour-zero) | Amendments by #10 only |
| `lib/store/index.ts` | T1 | Interface only |
| `lib/store/select.ts` | T3 | #16 changes the impl selection here, so T1's file stays untouched |
| `lib/user/session.ts` | T1 | Session minting. Security-sensitive — changes reviewed |
| `types/llm-tools.ts`, `types/chat-wire.ts`, `lib/llm/tools/definitions.ts` | #9 | #9 alone. Domain owners file a change request, they do not edit |
| `lib/geo/segment.ts`, `lib/geo/distance.ts`, `lib/routing/geocode.ts` | #10 | #12/#13/#14/#15 import, never reimplement |
| `lib/congestion/decay.ts` | #11 | #13/#15 import `DEFAULT_DECAY_CONFIG`; never inline 15/45/120 |
| `app/api/alerts/route.ts` | T1 creates stub → **hands to T3** | Same handoff convention as the tool handlers |
| `app/debug/page.tsx` | T1 creates → **hands to T2** | Ships before the chat UI |
| `data/traffic-alerts/**` | T1 writes, T3 reads | #14 parses; never written to at runtime |
| `.env.example`, `lib/config.ts` | #7 | Everyone else files a one-line PR to add a key |

Tests colocate as `foo.test.ts` beside `foo.ts`. No root `__tests__/` — it becomes a five-way
conflict within a week.

**Dependency arrow, one way only:** `api/chat → llm → handlers → domain`. `lib/routing/`,
`lib/overlay/` and `lib/reports/` must never import from `lib/llm/`. A domain module importing
`types/llm-tools.ts` is a review-blocking error. Handlers are the only adapter layer: domain
modules throw ordinary errors, handlers catch and map to `ToolError`. That is why #15 owns
`get-route.ts` rather than #10 — the tool must return congestion-ranked routes, and #10's honest
output is unranked.

---

## `types/congestion.ts`

```ts
/**
 * FROZEN CONTRACT. Owner: T1 (hour-zero commit).
 * Every timestamp is an ISO-8601 UTC string ("2026-09-12T06:20:50Z").
 * Date objects and epoch numbers NEVER cross a module boundary.
 * Dhaka is UTC+06:00 with no DST; local-time logic lives only in lib/congestion/time.ts (#11).
 */
export type IsoTimestamp = string;

export type ReportId = string;   // uuid v4
export type SessionId = string;  // minted server-side, see lib/user/session.ts
export type SegmentId = string;  // ONLY produced by segmentKey() in lib/geo/segment.ts (#10)

export interface LatLng {
  lat: number;
  lng: number;
}

export type Severity = 'low' | 'medium' | 'high';

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export type ReportSource = 'user' | 'dataset' | 'seed';

/** THE entity. #11 #12 #13 #14 #15 #16 all read and write this and nothing else. */
export interface CongestionReport {
  id: ReportId;
  source: ReportSource;

  /**
   * Who claims this. #13 counts DISTINCT reporterIds — never raw row count.
   * User reports: the SessionId. Dataset rows: `dataset:${externalId}`.
   * Without this, a cluster of 40 ingested dataset rows has 0 distinct reporters and the
   * entire consensus feature silently reports low confidence on the only data that exists.
   */
  reporterId: string;

  /** Set when source === 'user'; null otherwise. #13 uses it to reject self-corroboration. */
  sessionId: SessionId | null;

  /** Identity in the source system. Ingestion upserts on (source, externalId). */
  externalId: string | null;
  /** Provenance for debugging, e.g. "2026-09-12T06-20-50Z.md#L14". */
  sourceRef: string | null;

  location: LatLng;
  /** As reported or ingested, e.g. "Mirpur Road". Unnormalised, display only. */
  roadName: string | null;
  /** Normalised key assigned at write time. Null when the point could not be snapped. */
  segmentId: SegmentId | null;
  severity: Severity;

  /** When the congestion was OBSERVED. The only field decay may read. */
  observedAt: IsoTimestamp;
  /** When the row entered our store. Audit only — never used for scoring. */
  ingestedAt: IsoTimestamp;

  note: string | null;
}

/* ---------- #11: decay. Derived, never persisted onto CongestionReport. ---------- */

export interface DecayConfig {
  fullWeightMinutes: number;   // 15
  decayEndMinutes: number;     // 45
  expiryMinutes: number;       // 120
  fullWeight: number;          // 1.0
  decayCeiling: number;        // 0.7
  decayFloor: number;          // 0.3
  staleWeight: number;         // 0.1
  /** Rush hour stretches every window; hours are Asia/Dhaka local. */
  rushHourMultiplier: number;  // 1.5
  rushHourWindowsLocal: Array<{ startHour: number; endHour: number }>;
}

export interface DecayedReport extends CongestionReport {
  /** 0..1, age-based. NOT called "confidence" — that word belongs to #13. */
  freshness: number;
  ageMinutes: number;
  /** true => every caller must exclude this report. */
  expired: boolean;
}

/** Type alias, not a declaration — lib/congestion/decay.ts declares the real function. */
export type DecayFn = (
  report: CongestionReport,
  now: IsoTimestamp,
  config?: DecayConfig,
) => DecayedReport;

/* ---------- #13: consensus ---------- */

export type ConfidenceLevel = 'low' | 'medium' | 'high';

/** A set of DecayedReports judged to be "the same jam". */
export interface CongestionCluster {
  /** Deterministic: `${segmentId ?? geohash}:${windowStart}` */
  clusterId: string;
  segmentId: SegmentId | null;
  centroid: LatLng;
  roadName: string | null;
  /** Freshness-weighted consensus severity across members. */
  severity: Severity;
  /** DISTINCT reporterIds. 1 => low, 2-3 => medium, 4+ => high. */
  reporterCount: number;
  confidence: ConfidenceLevel;
  /** max(freshness) across members — how current this claim is. */
  freshness: number;
  /** sum(freshness * SEVERITY_WEIGHT[severity]). #15 sums these and nothing else. */
  weight: number;
  windowStart: IsoTimestamp;
  windowEnd: IsoTimestamp;
  memberIds: ReportId[];
}

export interface ConsensusConfig {
  clusterRadiusMeters: number;   // 200
  windowMinutes: number;         // 30
  mediumThreshold: number;       // 2 distinct reporters
  highThreshold: number;         // 4 distinct reporters
}

export type ClusterFn = (
  reports: DecayedReport[],
  now: IsoTimestamp,
  config?: ConsensusConfig,
) => CongestionCluster[];

/* ---------- #14: ingestion seam ---------- */

export interface ParseResult {
  reports: CongestionReport[];
  skipped: Array<{ row: number; reason: string }>;
}

/** Swapping the real dataset in is ONE new class implementing this. Nothing downstream changes. */
export interface DatasetParser {
  readonly name: string;
  parse(raw: string, now: IsoTimestamp): Promise<ParseResult>;
}
```

`DEFAULT_DECAY_CONFIG` and `DEFAULT_CONSENSUS_CONFIG` live in `lib/congestion/decay.ts` and
`lib/congestion/consensus.ts`, owned by #11 and #13 — **not** in the frozen types file, whose
amendment rule would otherwise require two approvals every time #11 tunes a threshold, which is
#11's entire job.

## `lib/store/index.ts` — the persistence seam

```ts
import type {
  CongestionReport, ReportId, SegmentId, LatLng, IsoTimestamp, SessionId, Severity,
} from '@/types/congestion';

export interface CongestionQuery {
  near?: { center: LatLng; radiusMeters: number };
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  segmentIds?: SegmentId[];
  /**
   * Explicit cutoffs, NOT `includeExpired`. The store must not know the decay rules —
   * lib/congestion/query.ts computes the cutoff from DecayConfig and passes a timestamp.
   * This keeps the store dumb and #16's swap trivial.
   */
  observedAfter?: IsoTimestamp;
  observedBefore?: IsoTimestamp;
  limit?: number;  // default 500
}

/** #12 and #14 write through this. #16 swaps the implementation and touches ZERO call sites. */
export interface CongestionStore {
  insert(report: CongestionReport): Promise<void>;
  /**
   * UPSERT on (source, externalId) when externalId is non-null.
   * Without this, re-running ingestion double-counts: one file ingested twice turns
   * 2 reporters into 4 and fabricates "high confidence" out of nothing.
   */
  insertMany(reports: CongestionReport[]): Promise<{ inserted: number; updated: number; skipped: number }>;
  query(q: CongestionQuery): Promise<CongestionReport[]>;
  getById(id: ReportId): Promise<CongestionReport | null>;
  purgeBefore(cutoff: IsoTimestamp): Promise<number>;
}

/** #6, descoped: session-scoped user state. NEVER written into data/traffic-alerts/**. */
export interface UserState {
  sessionId: SessionId;
  savedRoutes: Array<{ label: string; origin: string; destination: string }>;
  preferences: { severityFloor?: Severity; notifyAreas?: string[] };
  recentQueries: Array<{ text: string; at: IsoTimestamp }>;
}

export interface UserStore {
  get(sessionId: SessionId): Promise<UserState | null>;
  put(state: UserState): Promise<void>;
}
```

`getStore()` / `getUserStore()` live in `lib/store/select.ts` (owned by T3) so #16 can swap the
implementation without touching T1's interface file.

**Hour-zero implementation is KV-backed, not a plain in-memory array.** Vercel serverless functions
do not share memory across invocations, so an in-memory store loses user reports between requests
and the #12 → #13 consensus demo can never fire. This is a silent failure — no error anywhere.

### Session identity is not client-supplied

`sessionId` is minted server-side by `lib/user/session.ts` into an httpOnly signed cookie. It is
**never** accepted from a request body or a tool input, and `SubmitReportInput` must not gain a
`sessionId` field. Otherwise any caller can pass any session ID string and read any user's saved
routes and query history — exactly the leak #6 forbids.

## `types/routing.ts`

```ts
import type {
  LatLng, Severity, ConfidenceLevel, CongestionCluster, IsoTimestamp, SegmentId,
} from './congestion';

export interface Place {
  name: string;          // "Gulshan 1"
  displayName: string;   // full Nominatim / gazetteer string
  location: LatLng;
  /** 0..1. Below 0.5 the handler MUST ask the user to disambiguate. */
  confidence: number;
  source: 'nominatim' | 'gazetteer';
}

/** Ordered by confidence desc. Declared in lib/routing/geocode.ts. */
export type ResolvePlaceFn = (query: string) => Promise<Place[]>;

export interface RouteStep {
  name: string | null;
  distanceMeters: number;
  durationSeconds: number;
  /** Decoded to {lat,lng}. Raw GeoJSON [lng,lat] arrays never cross a boundary. */
  geometry: LatLng[];
}

export interface Route {
  routeId: string;   // `${requestId}:${index}`
  summary: string;   // "via Mirpur Rd"
  distanceMeters: number;
  /**
   * OSRM free-flow estimate. It knows NOTHING about Dhaka congestion.
   * Never surface this number to the user on its own.
   */
  durationSeconds: number;
  geometry: LatLng[];
  steps: RouteStep[];
}

export interface RouteRequest {
  origin: LatLng | { query: string };
  destination: LatLng | { query: string };
  alternatives: number;  // default 3, max 3
}

/** #10's terminal output. Unscored, in OSRM order. */
export interface RouteResult {
  requestId: string;
  origin: Place;
  destination: Place;
  routes: Route[];
}

/**
 * #10 owns road identity. #13 and #15 import this; they never invent their own key.
 *
 * Snapped grid cell (geohash precision 7, ~150m, chosen to match the 200m cluster radius).
 * Deliberately NOT based on an OSM way ID: the public OSRM /route response does not return
 * way IDs, so a wayId-based key would be null on every real call, degenerate to a point hash,
 * and congestion would silently never match routes.
 */
export type SegmentKeyFn = (point: LatLng) => SegmentId;

/* ---------- #15: overlay. Composition, not `extends Route`, so #10's and #15's diffs stay disjoint. ---------- */

export type CongestionCoverage = 'reported' | 'partial' | 'no-reports';

export interface ScoredRoute {
  route: Route;
  /** Sum of cluster.weight matched onto this route. Higher = worse. */
  congestionScore: number;
  /** 'no-reports' means we have no data. The LLM must say "no reports", never "clear". */
  coverage: CongestionCoverage;
  worstSeverity: Severity | null;
  confidence: ConfidenceLevel | null;
  hotspots: Array<{ cluster: CongestionCluster; distanceAlongRouteMeters: number }>;
}

export interface RankedRoutes {
  requestId: string;
  origin: Place;
  destination: Place;
  /** Ascending congestionScore; ties broken by durationSeconds. */
  ranked: ScoredRoute[];
  dataAsOf: IsoTimestamp;
}
```

Route↔cluster matching in `lib/overlay/match.ts` is **perpendicular distance to the decoded
polyline under a fixed buffer**, not segment-key equality. Key equality is the fallback for exact
hits, not the primary mechanism.

## `types/llm-tools.ts` — owner #9

```ts
import type { Place, RankedRoutes } from './routing';
import type {
  CongestionCluster, Severity, ReportId, SessionId, IsoTimestamp,
} from './congestion';

export type ToolName = 'query_congestion' | 'get_route' | 'submit_report';

export interface ToolError {
  code: 'upstream_timeout' | 'not_found' | 'ambiguous' | 'rate_limited' | 'invalid_input';
  message: string;   // user-safe; the model may paraphrase it
  retryable: boolean;
}

export interface QueryCongestionInput {
  area: string;
  radiusMeters?: number;  // default 1500
  /** Explicit historical window. Decay is bypassed when present. */
  window?: { from: IsoTimestamp; to: IsoTimestamp };
}

export interface QueryCongestionOutput {
  area: Place | null;
  clusters: CongestionCluster[];
  dataAsOf: IsoTimestamp;
  /** True when zero non-expired reports exist in range. Guardrail enforced in code, not prose. */
  noData: boolean;
}

export interface GetRouteInput {
  origin: string;
  destination: string;
  alternatives?: number;
}

/** Discriminated, consistent with SubmitReportOutput — no `'error' in x` narrowing at call sites. */
export type GetRouteOutput =
  | { status: 'ok'; result: RankedRoutes }
  | { status: 'error'; error: ToolError };

export interface SubmitReportInput {
  location: string;   // free text; the handler geocodes it via resolvePlace()
  severity: Severity;
  /** The handler REJECTS the call when false. #12's confirmation flow, enforced at the type level. */
  confirmed: boolean;
  observedAt?: IsoTimestamp;  // defaults to now
  note?: string;
  // NOTE: no sessionId. It comes from ToolContext, minted server-side.
}

export type SubmitReportOutput =
  | { status: 'stored'; reportId: ReportId; cluster: CongestionCluster }
  | { status: 'needs_confirmation'; interpreted: { place: Place; severity: Severity } }
  | { status: 'ambiguous_location'; candidates: Place[] }
  | { status: 'rejected'; reason: string };

export interface ToolContext {
  /** From the signed httpOnly cookie. Never from the request body. */
  sessionId: SessionId;
  now: IsoTimestamp;
  signal: AbortSignal;
}

/** The ONLY signature a domain team implements. */
export type ToolHandler<I, O> = (input: I, ctx: ToolContext) => Promise<O>;
```

**Single source of truth for tool inputs:** the zod schemas in `lib/llm/tools/definitions.ts` are
authoritative; every `*Input` above is a `z.infer<>` re-export. Hand-writing the interface *and*
the zod schema guarantees drift.

## `types/chat-wire.ts` — owner #9, sole consumer #8

```ts
import type { ToolName, QueryCongestionOutput, SubmitReportOutput } from './llm-tools';
import type { RankedRoutes } from './routing';

export type ChatStreamEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'text_delta'; text: string }
  /**
   * `label` is server-authored ("Checking routes…") so the UI renders tool activity
   * without importing anything from lib/. This is what keeps the UI/LLM split clean.
   */
  | { type: 'tool_start'; toolUseId: string; toolName: ToolName; label: string }
  /**
   * Structured payload so #8 can render three ranked routes as a CARD, not just prose the
   * model paraphrases. Without this event, "surface the suggestion in the chat interface"
   * (migrated from #5) is unbuildable.
   */
  | {
      type: 'tool_result';
      toolUseId: string;
      toolName: ToolName;
      data: QueryCongestionOutput | RankedRoutes | SubmitReportOutput;
    }
  | { type: 'tool_end'; toolUseId: string; ok: boolean }
  | { type: 'message_stop'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' }
  | {
      type: 'error';
      code: 'rate_limited' | 'upstream' | 'timeout' | 'bad_request';
      message: string;
      retryAfterSeconds?: number;
    };
```

## `lib/llm/tools/registry.ts` — created ONCE by #9, then never edited again

```ts
import type { ToolName, ToolHandler } from '@/types/llm-tools';
import { queryCongestion } from './handlers/query-congestion';  // owner #13
import { getRoute }        from './handlers/get-route';         // owner #15
import { submitReport }    from './handlers/submit-report';     // owner #12

export const TOOL_HANDLERS = {
  query_congestion: queryCongestion,
  get_route:        getRoute,
  submit_report:    submitReport,
} as const satisfies Record<ToolName, ToolHandler<any, any>>;
```

Because all three imports are static and complete from hour zero, nobody ever appends to this file.
Each owner edits only their own handler file: a four-way merge conflict becomes zero conflicts.
Each stub returns a valid, honest placeholder — not a throw — so #8 and #9 demo end to end on day
one with nobody else merged:

```ts
// lib/llm/tools/handlers/get-route.ts — #9 writes this stub, then hands the file to #15.
export const getRoute: ToolHandler<GetRouteInput, GetRouteOutput> = async () => ({
  status: 'error',
  error: { code: 'not_found', message: 'Routing is not wired up yet.', retryable: false },
});
```

---

## Known risks

**T2 is the bottleneck.** Every other track's output is invisible until it passes through the chat.
Handlers are *injected, never implemented* — the moment T2 writes congestion logic "just to test
it", the parallelism collapses. Ship `/debug` before the chat UI so every other track self-serves.

**T4's risk is geocoding, not routing.** An OSRM route is a solved HTTP call. Resolving colloquial
Dhaka names ("Mirpur 10", "Gulshan 2", "Bashundhara Gate") through a rate-limited public Nominatim
with uneven OSM coverage will eat the schedule. Ship the committed ~40–60 entry gazetteer *before*
the OSRM client, and cache OSRM responses to `data/fixtures/osrm/` on first fetch.

**T3/T5 is the one true two-way seam.** Both touch a report being created. T3 writes
`submitReport` and its tests first, against fixtures; T5 codes to that signature and never reaches
past it into the store. If this seam starts generating questions, merge the two tracks — it is the
designated collapse point. Never collapse T3 into T4: that recreates the exact critical path this
design exists to break.

**Wave 3 is the real schedule choke point.** Parallelism honestly drops to ~3. Adding people makes
it slower.
