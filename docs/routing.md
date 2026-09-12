# Routing

Answers "I'm going from Gulshan to Dhanmondi — any issues on the way?" by combining two
independent sources:

| Source | Gives us | Does **not** give us |
|---|---|---|
| OpenStreetMap (gazetteer + Nominatim + OSRM) | where places are, which roads a drive uses | anything about current conditions |
| `data/traffic-alerts/**` | crowd-sourced reports of jams, closures, accidents | coordinates, or which road a report belongs to |

Neither is useful alone. The join between them is **area names**, not geometry — see
[Corridor detection](#corridor-detection).

## Free, keyless, no account

Nothing here needs an API key or a paid plan.

- **[Gazetteer](../src/lib/routing/gazetteer.ts)** — ~80 hand-curated Dhaka landmarks with
  coordinates and the Banglish spellings people actually type. Tried first because OSM search
  resolves colloquial names like "Dhanmondi 27" or "Bijoy Soroni" poorly, and because an
  offline hit costs nothing.
- **[Nominatim](https://nominatim.openstreetmap.org)** — OSM's geocoder, the fallback for
  anything not in the gazetteer. Restricted to Bangladesh, one request per second (enforced
  in `geocode.ts`), results cached in-process.
- **[OSRM demo server](https://router.project-osrm.org)** — driving routes over the OSM road
  network, including alternatives, road names and full geometry.

Both public instances are shared, best-effort and rate-limited. Point `NOMINATIM_BASE_URL` and
`OSRM_BASE_URL` at your own instances before putting real user traffic through them; nothing in
the calling code changes.

Attribution is required when any of this is displayed: *"© OpenStreetMap contributors"* (ODbL).

### How confident a name match has to be

A wrong guess sends someone down the wrong road, so only a whole-name match is allowed to route
unprompted:

| What matched | Confidence | What happens |
|---|---|---|
| The exact name or an alias — `dhanmondi 27`, `bijoy soroni` | 1.0 | routes |
| A whole name inside a sentence — `heading to bijoy soroni now` | 0.8 | routes |
| A Nominatim result | 0.5–0.7 | routes, flagged `uncertain` so the assistant names its assumption |
| A fragment of a name — `mirpur`, `27` | 0.4 | below the threshold: the assistant asks which one was meant |

That last row is why `mirpur` does not silently become Mirpur 10. Every candidate comes back as a
suggestion instead.

## Corridor detection

Traffic reports carry no coordinates — they say "Bijoy Sarani is stuck", not a lat/lng. So a
route cannot be matched to reports geometrically.

Instead, `osrm.ts` walks the gazetteer against the decoded route polyline and lists every area
within `CORRIDOR_RADIUS_METERS` (800m) of it, in travel order:

```
Gulshan 1 → Mohakhali → Nakhalpara → Tejgaon → Farmgate → Bijoy Sarani
  → Manik Mia Avenue → Asad Gate → Dhanmondi 32 → Dhanmondi 27
```

That list is in the same vocabulary the reports use, so the model can check them off one by one.
Adding a gazetteer entry therefore improves both geocoding *and* corridor coverage.

## How a question flows

1. `/api/chat` sends the conversation to the model with the `get_route` tool available.
2. For a journey question the model calls `get_route(origin, destination)`.
3. [`runGetRoute`](../src/lib/llm/tools.ts) resolves both places, fetches routes, and returns
   distance, free-flow time, main roads and areas — never the raw geometry.
4. The model matches those roads and areas against the traffic reports already in its system
   prompt, and answers.

Failures are returned to the model as ordinary results (`place_not_found`, `no_route`,
`routing_unavailable`) with a hint, so a routing outage degrades to an answer from the reports
alone rather than costing the user their reply.

## Empty snapshots

`data/traffic-alerts/**` is read newest first, so a placeholder snapshot — `Status: No live data
source configured yet` over an empty Alerts table — used to land at the top of the model's
context and read as "there is no traffic data", even with hundreds of real reports below it.
`hasReports()` in `lib/traffic/loadAlerts.ts` now drops any snapshot carrying neither a post nor
a populated Alerts row.

## Two things the model must never do

Both are enforced by the system prompt in `src/app/api/chat/route.ts`:

- **Quote `freeFlowMinutes` as an ETA.** It is OSRM's empty-road estimate and knows nothing
  about Dhaka congestion. Distance in km is safe; time is not.
- **Call a stretch "clear" because no report mentions it.** No report means no data. The
  correct answer is "no reports for that stretch".

## Checking it without the model

```
GET /api/route?from=Gulshan%201&to=Dhanmondi%2027
```

Returns the resolved places and routes straight from the routing layer — the way to tell a
geocoding or OSRM problem apart from a prompting one. Add `&geometry=1` for the full polyline.

## Tests

```
npm test
```

Vitest, colocated as `foo.test.ts` beside `foo.ts`. Every test stubs `fetch` — none of them
touch the public OSM services, which would be slow and would fail for reasons unrelated to this
code. `osrm.fixture.ts` holds the canned route.

The geocoder leaves a one-second cool-off pending after each Nominatim call. Test files that
trigger one install fake timers and flush the gap in `afterEach`, which keeps the real rate limit
intact while the suite stays under a second.

## Known gaps

- Route options are returned in OSRM's order. Ranking them by reported congestion is
  [#15](https://github.com/zayansalman/trafficalert/issues/15) and is not implemented.
- Matching is by area name via the model, not by geometry. Once reports carry coordinates, the
  polyline-buffer matching described in `parallel-plan.md` becomes possible and is stricter.
- The live OSM calls have no coverage; only the parsing and failure handling around them do.
