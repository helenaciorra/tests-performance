# Performance Test Suite

Performance tests for the [Open-Meteo API](https://open-meteo.com/) using **k6**, covering three distinct scenarios: normal load, stress, and spike.

![Performance Tests](https://github.com/helenaciorra/tests-performance/actions/workflows/performance-tests.yml/badge.svg)

---

## Stack

| Tool       | Version | Role                          |
|------------|---------|-------------------------------|
| k6         | latest  | Load testing engine           |
| JavaScript | ES2020  | Script language (k6 built-in) |

---

## Structure

```
tests-performance/
├── src/
│   ├── helpers.js            # Shared locations and URL builder
│   ├── forecast-load.js      # Normal load: ramp-up + steady state + ramp-down
│   ├── forecast-stress.js    # Stress: progressively increasing until breaking point
│   └── forecast-spike.js     # Spike: sudden burst of traffic
├── .github/
│   └── workflows/
│       └── performance-tests.yml
└── package.json
```

---

## Setup

### Install k6

**Windows — via winget:**
```bash
winget install k6 --source winget
```

**Windows — via .msi installer:**
Download from [k6.io/docs/get-started/installation](https://k6.io/docs/get-started/installation/) and run the installer.

**Mac:**
```bash
brew install k6
```

**Linux (Debian/Ubuntu):**
```bash
sudo gpg --no-default-keyring   --keyring /usr/share/keyrings/k6-archive-keyring.gpg   --keyserver hkp://keyserver.ubuntu.com:80   --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main"   | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

**Verify installation:**
```bash
k6 version
# k6 v0.50.0 (...)
```

---

## How to run

```bash
# Smoke test — quick sanity check (2 VUs, 30s)
npm run test:smoke

# Load test — normal traffic pattern (~4 minutes)
npm run test:load

# Stress test — find the breaking point (~3.5 minutes)
npm run test:stress

# Spike test — sudden traffic burst (~2.5 minutes)
npm run test:spike
```

k6 prints a full summary in the terminal after each run, including percentile breakdowns, error rates, and threshold results (✓ pass / ✗ fail).

---

## Scenarios

### 🟢 Load Test — `forecast-load.js`
Simulates normal business-day traffic with a gradual ramp-up, a steady period, and a clean ramp-down.

| Stage     | Duration | VUs |
|-----------|----------|-----|
| Warm-up   | 30s      | 3   |
| Ramp-up   | 1m       | 8   |
| Steady    | 2m       | 8   |
| Ramp-down | 30s      | 0   |

**Thresholds:** `p(95) < 1500ms` · `http_req_failed < 5%`

**Observed results:** `p90=168ms`, `p95=173ms` — API is fast under normal load. Occasional EOF errors (~1.7%) occur when the server closes idle connections; these are handled defensively by the script.

---

### 🔴 Stress Test — `forecast-stress.js`
Progressively increases load to find the point where the API starts degrading. The goal is observation, not passing thresholds.

| Stage    | Duration | VUs |
|----------|----------|-----|
| Baseline | 30s      | 10  |
| Step 2   | 30s      | 30  |
| Step 3   | 30s      | 60  |
| Peak     | 30s      | 100 |
| Hold     | 1m       | 100 |
| Recovery | 30s      | 0   |

**Thresholds:** `error_rate < 15%` (application-level checks only — HTTP failures excluded at this scale)

**Observed results:** Breaking point found around 30–60 VUs. At 100 VUs, the API closes ~90% of TCP connections before responding (`EOF`). The 0.29% application error rate confirms that connections which completed returned correct data. `p90=168ms` — fast when it responds.

---

### 🟡 Spike Test — `forecast-spike.js`
Simulates a sudden, unexpected burst of traffic.

| Stage     | Duration | VUs |
|-----------|----------|-----|
| Baseline  | 20s      | 5   |
| Spike     | 10s      | 100 |
| Sustain   | 1m       | 100 |
| Drop      | 10s      | 5   |
| Recovery  | 30s      | 5   |
| Ramp-down | 10s      | 0   |

**Thresholds:** `p(99) < 3000ms` (HTTP failures excluded — 429 is expected and accepted)

**Observed results:** At 100 VUs, the API returned 429 Too Many Requests for 100% of requests. `p99=171ms` — the rate limiter responds immediately, before requests reach the application. Body was never empty, confirming a structured error response is always returned. All 31,028 checks passed.

---

## API behaviour summary

Running all three scenarios revealed two distinct protection mechanisms in the Open-Meteo API:

| Scenario | VUs | Observed behaviour |
|----------|-----|--------------------|
| Load     | 8   | Stable, p95=173ms, ~1.7% occasional EOF |
| Stress   | 100 | TCP connections closed at ~30–60 VUs |
| Spike    | 100 | Rate limiter (429) triggers immediately, p99=171ms |

The API uses **connection dropping** under gradual stress and **rate limiting** under sudden spike — two different mechanisms at different layers of the stack. Both produce fast responses, indicating protections sit at the edge rather than the application layer.

---

## Custom metrics

| Metric              | Type    | What it measures                        |
|---------------------|---------|-----------------------------------------|
| `response_duration` | Trend   | Full response duration with percentiles |
| `error_rate`        | Rate    | Ratio of failed checks to total         |
| `total_requests`    | Counter | Total requests sent during the run      |
| `spike_duration`    | Trend   | Response duration specifically during spike |

---

## Technical decisions

**Three separate script files** — load, stress and spike serve fundamentally different purposes and have different threshold philosophies. A single file with flags would make each scenario harder to read and explain independently.

**`helpers.js` for shared logic** — the URL builder and location list are reused across all three scripts. Centralising them avoids duplication and makes it easy to add a new location or query parameter in one place.

**Five locations across different timezones** — distributing requests across São Paulo, London, Tokyo, New York and Sydney tests whether the API behaves consistently regardless of geographic location, and avoids artificially warming a single cache entry.

**`randomLocation()` instead of a fixed location** — produces a more realistic traffic distribution across virtual users.

**Defensive JSON parsing in load test** — `res.body ? JSON.parse(res.body) : null` guards against empty bodies on network failures. Without this, a failed request causes a `TypeError` in the `check()` callback, which is a runtime error rather than a clean check failure.

**429 accepted in stress and spike tests** — Treating 429 as a failure would penalise the API for working as intended. Both scripts explicitly accept `status 200 or 429` and document why.

**`http_req_failed` excluded from stress and spike thresholds** — at 100 VUs, the `http_req_failed` metric counts both EOF errors and 429 responses as failures, reaching 90–100%. Asserting a threshold on this metric at this scale would always fail regardless of API health. Application-level `check()` results are a more meaningful signal at this load level.

**Smoke test in CI, full tests locally** — running a 4-minute load test on every push would be slow and potentially abusive to a free public API. The CI workflow runs a 2-VU, 30-second smoke test to verify the scripts execute without errors. Full scenarios are run manually. The workflow also runs on a weekly schedule for regular baseline tracking.

---

## CI/CD

The GitHub Actions workflow runs a **smoke test** (2 VUs, 30s) on every push to `main`, on a **weekly schedule** every Monday at 6am UTC. k6 results are uploaded as an artifact after each run and retained for 30 days.
