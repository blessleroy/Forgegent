# Performance baseline (task 9.6)

- date: 2026-11-16T01:26:06.127Z
- concurrent tasks: 5 (cap default)
- wall time for one full wave: 42.4ms
- handler P50: 31.3ms / P95: 37.6ms
- isolation: all tasks completed with independent durations

Measured with a mocked agent loop (30ms simulated work); web API
P50/P95 for Hub endpoints should be measured against a real deploy
with a configured model endpoint (see README).
