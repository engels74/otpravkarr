# Curated IPTV Operator Runbook

## Architecture and access boundary

Dispatcharr owns provider imports, canonical channels, groups, numbering, logos, stream order, EPG assignment, profiles, proxying, and failover. Otpravkarr owns Plex authorization, level-1 subscriber provisioning, lineup-policy intent, profile reconciliation, and onboarding. Caddy is the only ingress; Dispatcharr and Otpravkarr share the VPN sidecar network namespace.

The production default is `core_bundles`. The approved groups are the seven curated groups listed below. The core is Danish General TV plus Danish Sport. Bundles use immutable identities: `danish-motorsport` and `uk-sports`; the UK bundle includes the active PPV group. User overrides may select `fixed`, `core_bundles`, or `approved_selection`. Effective groups are always intersected with live, approved, non-quarantine groups. A zero result receives the shared empty profile. Subscribers remain Dispatcharr level 1.

## Taxonomy and numbering

| Group | Numbers | Channels |
|---|---:|---|
| Danish — General TV | 1–10 | DR1, TV2, TV3, DR2, Kanal5, TV2 Charlie, TV2 News, 6’eren, DK4, DR Ramasjang |
| Danish — Sport | 100–106 | TV2 Sport, TV2 Sport X, TV3 Sport, Sport Live, Eurosport1, Eurosport2, V Sport Ultra |
| Danish — Motorsport | 130 | Motorvision TV |
| UK/English — Sport | 200–203 | Sky Main Event, Sky News, TNT1, TNT2 |
| UK/English — Football | 220–221 | Sky Premier League, Sky Football |
| UK/English — Motorsport | 240 | Sky F1 |
| UK/English — PPV/Events | 260–263 | Summer Shootout, Millbridge Speedway, USAC Indiana Sprint Week, Hoodslam |

The tracked Lineuparr source is `dispatcharr-plugins/Dispatcharr-Lineuparr-Plugin/Lineuparr/DK_Curated_lineup.json` in the parent project.

## Automation ownership

| Transition | Enabled owner | Manual/preview | Disabled overlap |
|---|---|---|---|
| Provider streams to canonical channels | Lineuparr | Lineuparr validation | Channel Mapparr import/create |
| Group, number, initial display name | Lineuparr | Approved rename delta only | Scheduled regroup/renumber/rename |
| Logo | Channel Mapparr after preview | Manual repair | Competing scheduled logo writer |
| Health and quarantine classification | IPTV Checker | Probe/status | Hard delete and second quarantine owner |
| Stream attachment and order | Stream-Mapparr | Regex/throughput preview | Name/tag-only sorting |
| EPG repair | EPG Janitor, source allowlisted | Dry-run/review | All-source healing |
| Virtual/filler EPG | EPGeditARR only for approved gaps | Preview/teardown | Healthy provider EPG overwrite |
| Event visibility | Event Channel Managarr | Status/rescan | Creation, numbering, stream sorting |
| Plugin state from Otpravkarr | Read-only advisory | Dispatcharr links | Settings/run/enable mutation |

All recurring plugin schedules except Event Channel Managarr remain disabled. ECM passed two consecutive zero-delta manual preview/apply cycles and runs at `0005,0405,0805,1205,1605,2005` UTC plus after M3U refresh. It changes event-profile visibility only. Recurring deletion remains forbidden.

## Refresh and maintenance sequence

1. Confirm the VPN sidecar is healthy and Dispatcharr/Otpravkarr share its egress.
2. Confirm a same-phase Dispatcharr backup and coherent Otpravkarr SQLite backup exist.
3. Refresh the healthy provider M3U and EPG sources; keep the broken `custom` M3U disabled.
4. Run Lineuparr validation/preview, then a bounded apply.
5. Run IPTV Checker with two workers. Stop or halve concurrency if failures/timeouts exceed 20%.
6. Run Stream-Mapparr preview and apply measured order only.
7. Preview Channel Mapparr; use one backed-up channel before any batch without a true preview.
8. Run source-scoped EPG Janitor dry-run. Leave low-confidence matches unapplied.
9. Run EPGeditARR only for approved missing/event data and verify healthy EPG was unchanged.
10. Run Event Channel Managarr status/rescan after refresh. It owns visibility only.
11. Reconcile Otpravkarr and assert every active subscriber is level 1 with a non-empty profile list.
12. Run authorized and unauthorized M3U/XMLTV/XC checks and inspect redacted logs.

## Ingress matrix

Public Dispatcharr access permits only credentialed query-based `get.php`, `player_api.php`, `panel_api.php`, and `xmltv.php`, plus the read-only credential-free logo cache path. Standard `/output/m3u*`, `/output/epg*`, `/hdhr*`, admin/API, VOD, series, movie, catch-up, and unrelated paths are denied. LAN policy remains unchanged.

Public `/live/{user}/{pass}/{channel}` remains default-denied because Dispatcharr 0.28.2 emits credential-bearing paths at warning level. Query-based XC metadata, M3U, and profile-scoped XMLTV remain available. The operator explicitly excluded public direct playback from this rollout's required surface; no broader route or credential-hiding proxy was added.

## EPG, quality, and events

Twenty-four of twenty-nine channels use exact country-scoped STRNG8K EPG assignments and currently have programs. Motorvision has no trustworthy provider match and remains unapplied. Twenty-four channels have logos. All 63 attached streams passed bounded checks at concurrency two. Ordered alternates were retained, and a controlled Sky F1 primary failure transferred bytes from an alternate before restoration.

The live provider catalog exposed 504 event candidates across 18 groups. Four current `UK| PPV EVENT` streams passed bounded `ffprobe` at H.264, 1280×720, 59.94 fps and became channels 260–263 in `UK/English — PPV/Events`. ECM dry-run/apply hid one bounded event, Otpravkarr reconciliation preserved that hidden membership, and ECM restored it. Two subsequent zero-delta manual cycles passed before scheduling. The persisted known-channel snapshot lets Otpravkarr add newly imported events without re-enabling ECM-hidden events. The fail-open control was proven with a temporary force-visible rule and restored empty afterward.

## Rollout and rollback

The deployed Otpravkarr image was built and published by GitHub Actions from reviewed source commit `cafb80a1dbdbe6cb4c857041bbc751bc65e9dadf`; Compose pins `ghcr.io/engels74/otpravkarr-docker@sha256:c67c0df2db41dc33cafd4dabba1a5b7664e0996c551b5df292a3048c7c7fd2c5`. Remote update run `30436989536` and multi-architecture build run `30437050399` passed. A bounded corrupt-snapshot injection proved membership remains unchanged, the failure is logged, and recovery succeeds after restoring valid state. Pullio updates are paused for Dispatcharr and Otpravkarr. Protected phase backups contain prior image IDs/digests, Compose/Caddy copies, PostgreSQL dump, coherent SQLite backups, persistent archives, plugin settings, and checkpoints.

Rollback is paired: restore the recorded prior image digest and the compatible pre-migration SQLite backup together, restore the saved Compose and authorized Caddy block, validate Caddy, then restart and run integrity/count/access checks. Never downgrade code against migrations 003 or 004. Isolated PostgreSQL and SQLite restores passed; measured restore time was 3 seconds. RPO is the latest verified phase backup. Targets remain 30 minutes for image/config rollback and 60 minutes with database restore.

## Operational triggers

Immediately disable subscribers and roll back on unauthorized catalog/guide/playback success, subscriber level 10, empty remote `channel_profiles`, credential material in logs/artifacts, unexpected SQLite creation, image-digest drift, plugin apply exceeding preview, recurring delete count above zero, or broken VPN egress. Block expansion when drift persists twice or longer than 15 minutes, backup age exceeds the phase, EPG mismatch rises 10 percentage points over staging, or repeated probe failure exceeds 20%.

## Verified limitations

- Public XC metadata, M3U, and XMLTV work; public direct playback remains intentionally outside the required surface and denied.
- No current candidate was ambiguous enough to justify an Unscheduled Events group; that taxonomy remains content-gated.
- Motorvision lacks a high-confidence EPG match and logo.
- Non-ECM plugin schedules remain intentionally disabled to prevent writer overlap.
