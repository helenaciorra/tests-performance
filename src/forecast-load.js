// Load test: gradual ramp-up to steady state, then ramp-down
// Simulates a normal business day traffic pattern
// Equivalent to a JMeter Thread Group with a ramp-up period

// Observed behaviour (2025-03-29, 8 VUs):
// - p90=168ms, p95=173ms — API is fast under normal load
// - max=10.55s — occasional outlier caused by TCP reconnection after EOF
// - ~1.7% of requests fail with EOF (connection closed by server)
// - These failures are expected on a free public API under concurrent load
// - The check() guard handles empty bodies defensively without throwing

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { randomLocation, forecastUrl } from "./helpers.js";

// Custom metrics — visible in the terminal summary and JSON output
const responseDuration = new Trend("response_duration", true);
const errorRate        = new Rate("error_rate");
const totalRequests    = new Counter("total_requests");

export const options = {
  stages: [
    { duration: "30s", target: 3  }, // warm-up
    { duration: "1m",  target: 8  }, // ramp-up — kept low for a free public API
    { duration: "2m",  target: 8  }, // hold steady
    { duration: "30s", target: 0  }, // ramp-down
  ],
  thresholds: {
    http_req_duration: ["p(90)<1000", "p(95)<1500"], // 95% of requests under 1.5s
    http_req_failed:   ["rate<0.05"],                // up to 5% failures tolerated (public API)
    error_rate:        ["rate<0.05"],
    response_duration: ["p(95)<1500"],
  },
};

export default function () {
  const loc = randomLocation();
  const url = forecastUrl(loc.lat, loc.lon);

  totalRequests.add(1);

  const res = http.get(url, { tags: { location: loc.name } });

  responseDuration.add(res.timings.duration);

  // Guard against empty body on network failures before parsing JSON
  const body = res.body ? JSON.parse(res.body) : null;

  const ok = check(res, {
    "status is 200":          (r) => r.status === 200,
    "has current weather":    ()  => body !== null && body.current !== undefined,
    "response time < 1500ms": (r) => r.timings.duration < 1500,
  });

  errorRate.add(!ok);
  sleep(1);
}