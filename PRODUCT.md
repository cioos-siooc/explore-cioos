# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users, all professional:

- **Researchers and analysts** finding ocean measurements for their own work and pulling a subset of them.
- **Government** staff (e.g. federal and provincial agencies) looking for observations to inform monitoring, management and policy.
- **Data managers and partners** (CIOOS regional associations, data providers) checking what is published and how their datasets appear.

First-time use is a primary design target: the application is complex, and even expert users arrive without knowing how it works. Onboarding, plain labels and contextual guidance matter as much as expert speed. The general public (communities, educators, students) is welcome but secondary as an audience.

## Product Purpose

The CIOOS Data Explorer (CDE) shows Canada's oceanographic datasets on one map: where and when measurements were taken, of which variables, by whom. It harvests metadata from ERDDAP servers run by CIOOS and its partners, from OBIS, and from CKAN catalogues, and lets anyone filter, inspect and download it for free.

Discovery is the core job. A visit succeeds when the user finds the right data, whether they then download a subset here or go on to the dataset's source record (ERDDAP or CKAN). Both endings count equally.

## Positioning

One map across every CIOOS regional association plus OBIS biodiversity records, searchable by space, time, ocean variable (EOV), platform and organization at once, with coverage shown as the real footprint of the measurements (hex cells swept from tracks, points for fixed stations) rather than a bounding box per dataset.

## Operating Context

- Map-first single-page app: a datasets sidebar, a Filters modal with chips, a Download modal, a time-coverage histogram, a per-cell "What's here" breakdown, and contextual tips.
- Downloads are queued: the user submits an email, a scheduler builds the subset, and a link arrives by email.
- Every dataset links back to its source record; CDE never becomes the system of record.
- Harvests run on a schedule, so counts and coverage change between visits.

## Capabilities and Constraints

- Bilingual: English and French everywhere (i18next); every string ships in both.
- Terminology: ERDDAP™ carries the trademark sign; EOV = Essential Ocean Variable; dataset types include time series, profiles, trajectories and OBIS occurrence data. Labels must not claim ERDDAP-specific traits for CKAN or OBIS records.
- Privacy is a product commitment, not a setting: no cookies and no consent banner; preferences live in localStorage only; the download email travels in the request body and is deleted 7 days after the job; Plausible analytics without personal data; Sentry (US-hosted) for errors and optional-email feedback. Any new storage, service or data flow must be added to the in-app Privacy notice and `PRIVACY.md`.
- Fonts are self-hosted; no third-party font CDN.
- Map projection is MapLibre (mercator/globe); polar projections are out of reach without a different map engine.

## Brand Commitments

- Part of CIOOS (Canadian Integrated Ocean Observing System / SIOOC). The CIOOS National theme is binding: its palette and fonts are encoded as `--cioos-*` tokens in `frontend/src/components/theme.css`, and components use those tokens rather than hardcoded values.
- Voice: plain, friendly, direct (e.g. "Explore Canada's ocean data on one map", "We read every message"). Explain, don't jargon.

## Evidence on Hand

- Live counts of datasets and organizations come from the API and appear in the About window; quote those, never invented figures.
- Real data: the production harvest (ERDDAP, OBIS, CKAN). No testimonials, case studies or usage statistics exist; do not fabricate any.

## Product Principles

1. **Learnable on the first visit, efficient on the fiftieth.** A first-time user can read the map and each panel and find their way without prior knowledge of the tool or its vocabulary; returning experts reach variables, formats, direct links and sizes without wading through the guidance.
2. **Show the real footprint.** Coverage, counts and time spans reflect the measurements themselves; never inflate, round up or approximate without saying so.
3. **Discovery before download.** Getting the user to the right dataset matters more than which exit they take; source links and downloads are equal citizens.
4. **Respect the visitor.** No tracking, no dark patterns, minimal data asked for, and every data flow disclosed.
5. **Equal in both languages.** French is never a partial or afterthought translation.

## Accessibility & Inclusion

No formal standard is binding. Work to best effort: keep the axe suite (`frontend` a11y tests) green, keyboard-reachable controls, and no meaning carried by colour alone.
