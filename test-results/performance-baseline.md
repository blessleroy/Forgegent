# Performance baseline (task 9.6)

- date: 2026-11-13T03:42:42.486Z
- concurrent tasks: 5 (cap default)
- wall time for one full wave: 31.8ms
- handler P50: 31.4ms / P95: 31.4ms
- isolation: all tasks completed with independent durations

Measured with a mocked agent loop (30ms simulated work); web API
P50/P95 for Hub endpoints should be measured against a real deploy
with a configured model endpoint (see README).
