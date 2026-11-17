# Performance baseline (task 9.6)

- date: 2026-11-17T08:03:29.627Z
- concurrent tasks: 5 (cap default)
- wall time for one full wave: 33.7ms
- handler P50: 32.6ms / P95: 32.7ms
- isolation: all tasks completed with independent durations

Measured with a mocked agent loop (30ms simulated work); web API
P50/P95 for Hub endpoints should be measured against a real deploy
with a configured model endpoint (see README).
