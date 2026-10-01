# System Monitoring with Prometheus + Grafana

> Reference: [viblo.asia](https://viblo.asia/p/monitor-cach-giam-sat-he-thong-don-gian-voi-prometheus-va-grafana-BQyJKjW54Me)

---

## The problem this solves

You can't fix what you can't see. Without monitoring, the only signal that
something's wrong is a user complaint — by which point the problem has
already been affecting people for a while. Monitoring means continuously
observing metrics like CPU, RAM, disk I/O, request latency, and error
rates so problems (and the exact time window they started) can be spotted
before or as they happen — the same principle behind the p50/p95/p99
latency tracking covered in `mid-level/api-latency-optimize.md`.

---

## How the two pieces fit together

```
Your app / server
      │  exposes metrics on an HTTP endpoint (e.g. /metrics)
      ▼
  Exporter  ──scrape (HTTP pull)──▶  Prometheus  ──query (PromQL)──▶  Grafana
 (collects raw                      (stores as a                    (renders as
  system/app data)                   time-series DB,                 dashboards,
                                      runs alert rules)                graphs, alerts)
```

- **Prometheus** is the collection + storage engine. It *pulls* metrics
  from configured targets ("exporters") on a schedule, stores every data
  point tagged with a timestamp (a **time-series database**), and can run
  rule-based alerting on top of that data.
- **Grafana** is the visualization layer. It doesn't collect anything
  itself — it queries a data source (Prometheus, among others) and turns
  the results into customizable dashboards, graphs, and alert views.

---

## Key architecture pieces

| Component | Role |
|---|---|
| **Exporter** | A small agent/daemon running alongside (or inside) the thing being monitored, exposing its metrics in a format Prometheus understands (e.g. `node_exporter` for host-level CPU/RAM/disk) |
| **Scraping** | Prometheus periodically makes an HTTP(S) request to each exporter's `/metrics` endpoint and pulls the current values — a *pull* model, not the target pushing data to Prometheus |
| **Time-series database (TSDB)** | Every metric is stored as a value tied to a timestamp, which is what makes it possible to graph "CPU usage over the last 24 hours" rather than only seeing the current value |
| **PromQL** | Prometheus's query language for slicing/aggregating stored metrics (e.g. rate of requests per second, 95th percentile latency over a time window) |
| **Dashboards** | Grafana panels built from PromQL queries — commonly imported from a shared dashboard ID rather than built from scratch (the article references dashboard ID `1860`, a widely used Node Exporter dashboard) |

---

## Basic setup shape (Docker Compose)

```yaml
# docker-compose.yml
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    # default login: admin / admin
```

```yaml
# prometheus.yml — tells Prometheus what to scrape and how often
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']
```

After both containers are up: add Prometheus as a data source inside
Grafana (pointing at `http://prometheus:9090`), then import a dashboard
(by ID, or build custom panels) to start visualizing the scraped metrics.

---

## Why this matters for backend API work specifically

This is the infrastructure that makes concrete, earlier in this
conversation, possible:

- **p50/p95/p99 latency per endpoint** (`api-latency-optimize.md`) — a
  histogram metric exported by your app, scraped by Prometheus, queried
  with PromQL (`histogram_quantile(0.99, ...)`), and graphed in Grafana.
- **RED method** (Rate, Errors, Duration) — the standard set of metrics
  most teams start with for any service, all naturally expressed as
  Prometheus counters/histograms.
- **Alerting on regressions** — Prometheus's rule engine can fire an alert
  the moment p99 latency or error rate crosses a threshold, instead of
  waiting for someone to notice a dashboard looks wrong.

## See also

- `mid-level/api-latency-optimize.md` — the p50/p95/p99 tracking this stack is built to support
- `prod-issues/feature-flag.md` — metrics from this stack are what you watch during a percentage rollout
