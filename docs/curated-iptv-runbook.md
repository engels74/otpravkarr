# Curated IPTV Operator Runbook

## Architecture and access boundary

Dispatcharr owns provider imports, canonical channels, groups, numbering, logos, stream order, EPG assignment, profiles, proxying, and failover. Otpravkarr owns Plex authorization, level-1 subscriber provisioning, lineup-policy intent, profile reconciliation, and onboarding. Caddy is the only ingress; Dispatcharr and Otpravkarr share the VPN sidecar network namespace.

The production default is `core_bundles`. The approved groups are the six curated groups listed below. The core is Danish General TV plus Danish Sport. Bundles use immutable identities: `danish-motorsport` and `uk-sports`. User overrides may select `fixed`, `core_bundles`, or `approved_selection`. Effective groups are always intersected with live, approved, non-quarantine groups. A zero result receives the shared empty profile. Subscribers remain Dispatcharr level 1.

## Taxonomy and numbering

| Group | Numbers | Channels |
|---|---:|---|
| Danish — General TV | 1–10 | DR1, TV2, TV3, DR2, Kanal5, TV2 Charlie, TV2 News, 6’eren, DK4, DR Ramasjang |
| Danish — Sport | 100–106 | TV2 Sport, TV2 Sport X, TV3 Sport, Sport Live, Eurosport1, Eurosport2, V Sport Ultra |
| Danish — Motorsport | 130 | Motorvision TV |
| UK/English — Sport | 200–203 | Sky Main Event, Sky News, TNT1, TNT2 |
| UK/English — Football | 220–221 | Sky Premier League, Sky Football |
| UK/English — Motorsport | 240 | Sky F1 |

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

All recurring plugin schedules remain disabled. The installed versions have not yet produced two stable manual runs over a representative changing catalog, so enabling recurrence would violate the rollout gate. Recurring deletion remains forbidden.

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

Public `/live/{user}/{pass}/{channel}` is disabled. Dispatcharr 0.28.2 emits the credential-bearing path at warning level despite four bounded suppression approaches (proxy logging controls, uWSGI logging controls, Django logger overrides, and a logging filter). Exposing it would violate the secret boundary. The last verified safe state is query-based XC/XMLTV access with public live paths denied. The first safe remediation is an upstream Dispatcharr credential-redaction fix or an explicitly authorized credential-hiding playback proxy, followed by the full route/log matrix.

## EPG, quality, and events

Twenty-four of twenty-five channels use exact country-scoped STRNG8K EPG assignments and currently have programs. Motorvision has no trustworthy provider match and remains unapplied. Twenty-four channels have logos. All 59 attached streams passed IPTV Checker; bounded `ffprobe` measurements used concurrency two. Ordered alternates were retained, and a controlled Sky F1 primary failure transferred bytes from an alternate before restoration.

The current provider catalog contains no trustworthy event channels matching the approved scheduled/unscheduled event taxonomy. No fake event groups were created. ECM is scope-configured without a schedule, but live in-window, ambiguous-event, and fail-open behavior cannot be proven until real event content exists.

## Rollout and rollback

The deployed Otpravkarr image is the immutable local review-fix build recorded in Compose; the running digest is `sha256:665677392eed912e26fe7f1624bdba0390b51d9acad9140f517f57650612f162`. Pullio updates are paused for Dispatcharr and Otpravkarr. The protected backup directory path is recorded locally in `/tmp/dispatcharr_overnight_backup_path`; it contains prior image IDs/digests, Compose/Caddy copies, PostgreSQL dump, coherent SQLite backup, persistent archives, plugin settings, and phase checkpoints.

Rollback is paired: restore the recorded prior image digest and the compatible pre-migration SQLite backup together, restore the saved Compose and authorized Caddy block, validate Caddy, then restart and run integrity/count/access checks. Never downgrade code against migration 003. Isolated PostgreSQL and SQLite restores passed; measured restore time was 3 seconds. RPO is the latest verified phase backup. Targets remain 30 minutes for image/config rollback and 60 minutes with database restore.

## Operational triggers

Immediately disable subscribers and roll back on unauthorized catalog/guide/playback success, subscriber level 10, empty remote `channel_profiles`, credential material in logs/artifacts, unexpected SQLite creation, image-digest drift, plugin apply exceeding preview, recurring delete count above zero, or broken VPN egress. Block expansion when drift persists twice or longer than 15 minutes, backup age exceeds the phase, EPG mismatch rises 10 percentage points over staging, or repeated probe failure exceeds 20%.

## Verified limitations

- Public XC metadata, M3U, and XMLTV work; public direct playback is blocked by credential-path logging.
- No real scheduled event content exists in the live catalog, so event transition and fail-open acceptance remain unverified.
- Motorvision lacks a high-confidence EPG match and logo.
- Plugin schedules are intentionally disabled pending two stable manual runs.
