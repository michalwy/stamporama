# Product Brief

## Name

Stamporama

## Purpose

Stamporama is a self-hosted web application for stamp collectors. It helps manage a personal stamp catalog, track collection state, coordinate trades with other collectors, and hunt for new stamps.

## Language

English first. Additional languages may be added later.

## Core Concepts

### Collection

A collection is the top-level organizing unit. Each user may own multiple collections (e.g. "Polish definitive stamps", "Airmail", "Thematic — birds"). Collections are scoped to a user. Collection URLs use `/c/[collectionSlug]/...`.

### Stamps (catalog)

Stamps in a collection are identified by catalog number (e.g. Michel, Scott, Fischer) and belong to a series. They may carry topics, country/area of origin, year of issue, and other descriptive attributes. This is not a full philatelic catalog — it only contains stamps the collector has defined.

### Collection items

Each physical copy a collector owns is a separate item (no quantity field — see ADR-0007). An item links a stamp to a copy's condition, certificate status, acquisition source, purchase price, disposition (in collection / for sale / for trade), physical storage location (see ADR-0010), and any notes. Copies of the same stamp and condition can differ (e.g. by postmark), so each is its own record.

## Planned Feature Areas

1. **Catalog** — stamps by catalog number, series, topic, country/area
2. **Collection** — ownership, condition, acquisition, duplicates for trade/sale
3. **Trading** — scope agreement and progress tracking with other collectors
4. **Purchases** — what was bought, where, for how much, in what condition
5. **Sales** — what was sold, where listed, final price, profit/loss
6. **Stamp hunting** — want list, auction monitoring, price history
7. **Integrations** — Collnect, Delcampe

## Deployment

Self-hosted via Docker Compose.

## Open Questions

- Should a collection be shareable with other users (read-only or collaborative)?
- Should catalog numbers be per-catalog-standard (Michel vs Scott vs Fischer) or free-form?
- Should condition follow a standard scale (e.g. VF/F/VG) or be free-form?
