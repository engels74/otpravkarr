# Dispatcharr API Documentation

> **Instance:** `https://dptv.cccp.ps`
> **Swagger UI:** `https://dptv.cccp.ps/swagger`
> **Base URL:** `https://dptv.cccp.ps/api/`

Dispatcharr provides a comprehensive REST API for programmatic access to all platform features — managing IPTV streams, channels, EPG data, recordings, VOD content, user accounts, plugins, and system settings.

---

## Table of Contents

- [Authentication](#authentication)
- [API Conventions](#api-conventions)
- [Accounts API](#accounts-api)
- [Channels API](#channels-api)
- [EPG API](#epg-api)
- [M3U API](#m3u-api)
- [VOD API](#vod-api)
- [Plugins API](#plugins-api)

---

## Authentication

Dispatcharr supports two authentication methods: **JWT tokens** and **API keys**.

### JWT Token Authentication (Recommended)

JWT tokens are short-lived bearer tokens ideal for user sessions and frontend applications.

#### Obtain a Token Pair

```
POST /api/accounts/token/
```

**Request Body:**

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `username` | string | Yes      | Username    |
| `password` | string | Yes      | Password    |

**Response:**

```json
{
  "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Using the Access Token

Include the token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

#### Refresh a Token

```
POST /api/accounts/token/refresh/
```

| Field     | Type   | Required | Description                  |
|-----------|--------|----------|------------------------------|
| `refresh` | string | Yes      | Refresh token from login     |

**Response:**

```json
{
  "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Alternative Login Endpoint

```
POST /api/accounts/auth/login/
```

Accepts the same `username` / `password` body and returns the same token pair.

### API Key Authentication

API keys are long-lived credentials for scripts, automations, and third-party integrations. Each user can have one active key at a time.

**Method 1 — Authorization Header (Recommended):**

```
Authorization: ApiKey <your_api_key>
```

**Method 2 — X-API-Key Header:**

```
X-API-Key: <your_api_key>
```

### Authentication Errors

| Code | Response Body                                              |
|------|------------------------------------------------------------|
| 401  | `{"detail": "Authentication credentials were not provided."}` |
| 401  | `{"detail": "Invalid token."}`                             |
| 401  | `{"detail": "Invalid API key."}`                           |
| 403  | `{"detail": "You do not have permission to perform this action."}` |

---

## API Conventions

### Response Format

All responses are JSON. Single-resource responses return the object directly. List endpoints return paginated results:

```json
{
  "count": 150,
  "next": "https://dptv.cccp.ps/api/channels/?page=2",
  "previous": null,
  "results": [ ... ]
}
```

### HTTP Status Codes

| Code | Meaning                                                |
|------|--------------------------------------------------------|
| 200  | Request succeeded                                      |
| 201  | Resource created                                       |
| 204  | Success, no response body (typically DELETE)            |
| 400  | Invalid request data or parameters                     |
| 401  | Authentication required or failed                      |
| 403  | Authenticated but lacking permissions                  |
| 404  | Resource not found                                     |
| 500  | Server-side error                                      |

### Standard CRUD Pattern

Most resources follow Django REST Framework ViewSet conventions:

| Method   | Path                      | Action                    |
|----------|---------------------------|---------------------------|
| `GET`    | `/api/<resource>/`        | List all (paginated)      |
| `POST`   | `/api/<resource>/`        | Create                    |
| `GET`    | `/api/<resource>/{id}/`   | Retrieve one              |
| `PUT`    | `/api/<resource>/{id}/`   | Full update               |
| `PATCH`  | `/api/<resource>/{id}/`   | Partial update            |
| `DELETE` | `/api/<resource>/{id}/`   | Delete                    |

### Filtering & Pagination

```
GET /api/channels/?channel_group=5
GET /api/channels/streams/?search=sports&m3u_account=1&enabled=true
GET /api/channels/?page=2&page_size=50
```

---

## Accounts API

Base path: `/api/accounts/`

### Authentication Endpoints

| Method | Endpoint                          | Description                 |
|--------|-----------------------------------|-----------------------------|
| POST   | `/api/accounts/token/`            | Obtain JWT token pair       |
| POST   | `/api/accounts/token/refresh/`    | Refresh access token        |
| POST   | `/api/accounts/auth/login/`       | Alternative login endpoint  |
| POST   | `/api/accounts/auth/logout/`      | Logout                      |

### Users

| Method | Endpoint                     | Description                     |
|--------|------------------------------|---------------------------------|
| GET    | `/api/accounts/users/`       | List all users (admin only)     |
| POST   | `/api/accounts/users/`       | Create user                     |
| GET    | `/api/accounts/users/{id}/`  | Get user                        |
| PUT    | `/api/accounts/users/{id}/`  | Update user                     |
| DELETE | `/api/accounts/users/{id}/`  | Delete user                     |

**User fields:**

| Field        | Type    | Required | Description                    |
|--------------|---------|----------|--------------------------------|
| `username`   | string  | Yes      | Unique username                |
| `password`   | string  | Yes      | Password (create only)         |
| `email`      | string  | No       | Email address                  |
| `is_staff`   | boolean | No       | Staff privileges (default: false) |
| `is_active`  | boolean | No       | Account active (default: true) |
| `groups`     | array   | No       | Array of group IDs             |

### Groups

| Method | Endpoint                      | Description        |
|--------|-------------------------------|--------------------|
| GET    | `/api/accounts/groups/`       | List groups        |
| POST   | `/api/accounts/groups/`       | Create group       |
| GET    | `/api/accounts/groups/{id}/`  | Get group          |
| PUT    | `/api/accounts/groups/{id}/`  | Update group       |
| DELETE | `/api/accounts/groups/{id}/`  | Delete group       |

**Group fields:**

| Field         | Type   | Required | Description                  |
|---------------|--------|----------|------------------------------|
| `name`        | string | Yes      | Group name                   |
| `permissions` | array  | No       | Array of permission IDs      |

### API Keys

| Method | Endpoint                          | Description              |
|--------|-----------------------------------|--------------------------|
| GET    | `/api/accounts/api-keys/`         | List API keys            |
| POST   | `/api/accounts/api-keys/`         | Generate new API key     |
| GET    | `/api/accounts/api-keys/{id}/`    | Get API key              |
| PUT    | `/api/accounts/api-keys/{id}/`    | Update API key           |
| DELETE | `/api/accounts/api-keys/{id}/`    | Revoke API key           |

**API Key fields:**

| Field        | Type    | Description                           |
|--------------|---------|---------------------------------------|
| `id`         | integer | API key ID                            |
| `name`       | string  | Key name/label (required on create)   |
| `key`        | string  | Key value (only shown on creation)    |
| `created_at` | string  | Creation timestamp                    |
| `last_used`  | string  | Last usage timestamp                  |
| `is_active`  | boolean | Whether key is active                 |

### Permissions

| Method | Endpoint                       | Description               |
|--------|--------------------------------|---------------------------|
| GET    | `/api/accounts/permissions/`   | List all permissions      |

### Superuser Initialization

```
POST /api/accounts/initialize-superuser/
```

Only available when no users exist. Creates the first admin account.

| Field      | Type   | Required | Description        |
|------------|--------|----------|--------------------|
| `username` | string | Yes      | Superuser username |
| `password` | string | Yes      | Superuser password |
| `email`    | string | No       | Email address      |

---

## Channels API

Base path: `/api/channels/`

### Streams

| Method | Endpoint                                | Description             |
|--------|-----------------------------------------|-------------------------|
| GET    | `/api/channels/streams/`                | List streams            |
| POST   | `/api/channels/streams/`                | Create stream           |
| GET    | `/api/channels/streams/{id}/`           | Get stream              |
| PUT    | `/api/channels/streams/{id}/`           | Update stream           |
| DELETE | `/api/channels/streams/{id}/`           | Delete stream           |
| GET    | `/api/channels/streams/ids/`            | Get stream IDs only     |
| GET    | `/api/channels/streams/groups/`         | Get stream group names  |
| POST   | `/api/channels/streams/bulk-delete/`    | Bulk delete streams     |

**List Streams query parameters:**

| Parameter              | Type    | Default | Description                                    |
|------------------------|---------|---------|------------------------------------------------|
| `page`                 | integer | 1       | Page number                                    |
| `page_size`            | integer | 50      | Items per page (max: 10000)                    |
| `name`                 | string  |         | Filter by name (case-insensitive contains)     |
| `channel_group_name`   | string  |         | Filter by group name (comma-separated)         |
| `m3u_account`          | integer |         | Filter by M3U account ID                       |
| `m3u_account_name`     | string  |         | Filter by M3U account name                     |
| `m3u_account_is_active`| boolean |         | Filter by M3U account active status            |
| `tvg_id`               | string  |         | Filter by TVG ID (case-insensitive contains)   |
| `assigned`             | integer |         | Filter streams assigned to channel ID          |
| `unassigned`           | boolean |         | Show only unassigned streams                   |
| `hide_stale`           | boolean |         | Hide stale streams                             |
| `ids`                  | string  |         | Comma-separated list of stream IDs             |

**Bulk Delete body:**

```json
{ "ids": [1, 2, 3, 4, 5] }
```

### Channels

| Method | Endpoint                                    | Description                 |
|--------|---------------------------------------------|-----------------------------|
| GET    | `/api/channels/channels/`                   | List channels               |
| POST   | `/api/channels/channels/`                   | Create channel              |
| GET    | `/api/channels/channels/{id}/`              | Get channel                 |
| PUT    | `/api/channels/channels/{id}/`              | Update channel              |
| DELETE | `/api/channels/channels/{id}/`              | Delete channel              |
| POST   | `/api/channels/channels/bulk-delete/`       | Bulk delete channels        |
| GET    | `/api/channels/channels/{id}/streams/`      | Get streams for a channel   |

**Create Channel body example:**

```json
{
  "name": "HBO",
  "number": 101,
  "enabled": true
}
```

### Channel Groups

| Method | Endpoint                        | Description           |
|--------|---------------------------------|-----------------------|
| GET    | `/api/channels/groups/`         | List channel groups   |
| POST   | `/api/channels/groups/`         | Create channel group  |
| GET    | `/api/channels/groups/{id}/`    | Get channel group     |
| PUT    | `/api/channels/groups/{id}/`    | Update channel group  |
| DELETE | `/api/channels/groups/{id}/`    | Delete channel group  |

### Logos

| Method | Endpoint                             | Description              |
|--------|--------------------------------------|--------------------------|
| GET    | `/api/channels/logos/`               | List logos               |
| POST   | `/api/channels/logos/`               | Create logo              |
| GET    | `/api/channels/logos/{id}/`          | Get logo                 |
| PUT    | `/api/channels/logos/{id}/`          | Update logo              |
| DELETE | `/api/channels/logos/{id}/`          | Delete logo              |
| POST   | `/api/channels/logos/bulk-delete/`   | Bulk delete logos        |
| POST   | `/api/channels/logos/cleanup/`       | Delete all unused logos   |

**Logo response fields:**

| Field           | Type    | Description                              |
|-----------------|---------|------------------------------------------|
| `id`            | integer | Logo ID                                  |
| `name`          | string  | Logo name                                |
| `url`           | string  | Original logo URL                        |
| `cache_url`     | string  | Cached logo URL served by Dispatcharr    |
| `channel_count` | integer | Number of channels using this logo       |
| `is_used`       | boolean | Whether the logo is used by any channels |
| `channel_names` | array   | Channel names using this logo (up to 5)  |

### Channel Profiles

| Method | Endpoint                                                   | Description                       |
|--------|------------------------------------------------------------|------------------------------------|
| GET    | `/api/channels/profiles/`                                  | List profiles                      |
| POST   | `/api/channels/profiles/`                                  | Create profile                     |
| GET    | `/api/channels/profiles/{id}/`                             | Get profile                        |
| PUT    | `/api/channels/profiles/{id}/`                             | Update profile                     |
| DELETE | `/api/channels/profiles/{id}/`                             | Delete profile                     |
| PUT    | `/api/channels/profiles/{id}/channels/{channel_id}/`       | Update channel membership          |
| POST   | `/api/channels/profiles/{id}/channels/bulk-update/`        | Bulk update channel membership     |

**Bulk update membership body:**

```json
{
  "memberships": [
    {"channel_id": 1, "enabled": true},
    {"channel_id": 2, "enabled": false}
  ]
}
```

### DVR Recordings

| Method | Endpoint                                             | Description                     |
|--------|------------------------------------------------------|---------------------------------|
| GET    | `/api/channels/recordings/`                          | List recordings                 |
| POST   | `/api/channels/recordings/`                          | Create recording                |
| GET    | `/api/channels/recordings/{id}/`                     | Get recording                   |
| PUT    | `/api/channels/recordings/{id}/`                     | Update recording                |
| DELETE | `/api/channels/recordings/{id}/`                     | Delete recording                |
| POST   | `/api/channels/recordings/bulk-delete-upcoming/`     | Bulk delete upcoming recordings |

**Create Recording body:**

```json
{
  "channel_id": 123,
  "program_id": 456,
  "start_time": "2026-03-03T20:00:00Z",
  "end_time": "2026-03-03T22:00:00Z"
}
```

### Recurring Recording Rules

| Method | Endpoint                                | Description               |
|--------|-----------------------------------------|---------------------------|
| GET    | `/api/channels/recurring-rules/`        | List recurring rules      |
| POST   | `/api/channels/recurring-rules/`        | Create recurring rule     |
| GET    | `/api/channels/recurring-rules/{id}/`   | Get recurring rule        |
| PUT    | `/api/channels/recurring-rules/{id}/`   | Update recurring rule     |
| DELETE | `/api/channels/recurring-rules/{id}/`   | Delete recurring rule     |

### Series Rules

| Method | Endpoint                                         | Description                        |
|--------|--------------------------------------------------|------------------------------------|
| GET    | `/api/channels/series-rules/`                    | List series rules                  |
| DELETE | `/api/channels/series-rules/{tvg_id}/`           | Delete series rule                 |
| POST   | `/api/channels/series-rules/evaluate/`           | Evaluate all rules                 |
| POST   | `/api/channels/series-rules/bulk-remove/`        | Bulk remove series recordings      |

**Bulk remove body:**

```json
{ "tvg_ids": ["series1.us", "series2.us"] }
```

### Comskip Configuration

| Method | Endpoint                                  | Description           |
|--------|-------------------------------------------|-----------------------|
| GET    | `/api/channels/dvr/comskip-config/`       | Get Comskip config    |
| PUT    | `/api/channels/dvr/comskip-config/`       | Update Comskip config |

---

## EPG API

Base path: `/api/epg/`

### EPG Sources

| Method | Endpoint                   | Description          |
|--------|----------------------------|----------------------|
| GET    | `/api/epg/sources/`        | List EPG sources     |
| POST   | `/api/epg/sources/`        | Create EPG source    |
| GET    | `/api/epg/sources/{id}/`   | Get EPG source       |
| PUT    | `/api/epg/sources/{id}/`   | Update EPG source    |
| DELETE | `/api/epg/sources/{id}/`   | Delete EPG source    |

**EPG Source fields:**

| Field          | Type    | Required | Description                        |
|----------------|---------|----------|------------------------------------|
| `name`         | string  | Yes      | EPG source name                    |
| `url`          | string  | Yes      | URL to XMLTV EPG data              |
| `enabled`      | boolean | No       | Whether source is active (default: true) |
| `last_updated` | string  | —        | Timestamp of last successful update (read-only) |

### Programs

| Method | Endpoint                    | Description        |
|--------|-----------------------------|--------------------|
| GET    | `/api/epg/programs/`        | List programs      |
| POST   | `/api/epg/programs/`        | Create program     |
| GET    | `/api/epg/programs/{id}/`   | Get program        |
| PUT    | `/api/epg/programs/{id}/`   | Update program     |
| DELETE | `/api/epg/programs/{id}/`   | Delete program     |

**List Programs query parameters:**

| Parameter    | Type   | Description                              |
|--------------|--------|------------------------------------------|
| `channel`    | string | Filter by channel TVG ID                 |
| `start_time` | string | Programs starting after this (ISO 8601)  |
| `end_time`   | string | Programs ending before this (ISO 8601)   |
| `search`     | string | Search titles and descriptions           |

**Program fields:**

| Field         | Type   | Required | Description              |
|---------------|--------|----------|--------------------------|
| `title`       | string | Yes      | Program title            |
| `description` | string | No       | Program description      |
| `start_time`  | string | Yes      | Start time (ISO 8601)    |
| `end_time`    | string | Yes      | End time (ISO 8601)      |
| `channel_id`  | string | Yes      | Channel TVG ID           |
| `category`    | string | No       | Program category/genre   |

### EPG Data

| Method | Endpoint                    | Description       |
|--------|-----------------------------|--------------------|
| GET    | `/api/epg/epgdata/`         | List EPG data      |
| POST   | `/api/epg/epgdata/`         | Create EPG data    |
| GET    | `/api/epg/epgdata/{id}/`    | Get EPG data       |
| PUT    | `/api/epg/epgdata/{id}/`    | Update EPG data    |
| DELETE | `/api/epg/epgdata/{id}/`    | Delete EPG data    |

### EPG Grid

```
GET /api/epg/grid/?start_time=2026-03-03T00:00:00Z&end_time=2026-03-03T23:59:59Z
```

| Parameter    | Type   | Required | Description                            |
|--------------|--------|----------|----------------------------------------|
| `start_time` | string | Yes      | Start time for grid (ISO 8601)         |
| `end_time`   | string | Yes      | End time for grid (ISO 8601)           |
| `channels`   | string | No       | Comma-separated channel IDs to include |

### EPG Import

```
POST /api/epg/import/
```

| Field       | Type    | Required | Description                                |
|-------------|---------|----------|--------------------------------------------|
| `source_id` | integer | No       | Specific source ID (omit to import all)    |
| `force`     | boolean | No       | Force reimport even if recently updated    |

**Response:**

| Field            | Type    | Description              |
|------------------|---------|--------------------------|
| `status`         | string  | success / pending / failed |
| `message`        | string  | Status message           |
| `imported_count` | integer | Number of programs imported |

### Current Programs

```
GET /api/epg/current-programs/
```

Returns currently airing programs. Optional `channels` query parameter accepts comma-separated channel IDs.

---

## M3U API

Base path: `/api/m3u/`

### M3U Accounts

| Method | Endpoint                     | Description          |
|--------|------------------------------|----------------------|
| GET    | `/api/m3u/accounts/`         | List M3U accounts    |
| POST   | `/api/m3u/accounts/`         | Create M3U account   |
| GET    | `/api/m3u/accounts/{id}/`    | Get M3U account      |
| PUT    | `/api/m3u/accounts/{id}/`    | Update M3U account   |
| DELETE | `/api/m3u/accounts/{id}/`    | Delete M3U account   |

**M3U Account fields:**

| Field            | Type    | Required | Description                        |
|------------------|---------|----------|------------------------------------|
| `name`           | string  | Yes      | Account name                       |
| `url`            | string  | Yes      | M3U playlist URL                   |
| `username`       | string  | No       | Username for authentication        |
| `password`       | string  | No       | Password for authentication        |
| `is_active`      | boolean | No       | Whether active (default: true)     |
| `last_refreshed` | string  | —        | Timestamp of last refresh (read-only) |
| `stream_count`   | integer | —        | Number of streams (read-only)      |

### M3U Account Profiles

| Method | Endpoint                                     | Description              |
|--------|----------------------------------------------|--------------------------|
| GET    | `/api/m3u/accounts/{id}/profiles/`            | List account profiles    |
| POST   | `/api/m3u/accounts/{id}/profiles/`            | Create account profile   |
| GET    | `/api/m3u/accounts/{id}/profiles/{pid}/`      | Get account profile      |
| PUT    | `/api/m3u/accounts/{id}/profiles/{pid}/`      | Update account profile   |
| DELETE | `/api/m3u/accounts/{id}/profiles/{pid}/`      | Delete account profile   |

### M3U Filters

| Method | Endpoint                                     | Description       |
|--------|----------------------------------------------|-------------------|
| GET    | `/api/m3u/accounts/{id}/filters/`            | List filters      |
| POST   | `/api/m3u/accounts/{id}/filters/`            | Create filter     |
| GET    | `/api/m3u/accounts/{id}/filters/{fid}/`      | Get filter        |
| PUT    | `/api/m3u/accounts/{id}/filters/{fid}/`      | Update filter     |
| DELETE | `/api/m3u/accounts/{id}/filters/{fid}/`      | Delete filter     |

**Filter fields:**

| Field         | Type    | Required | Description                       |
|---------------|---------|----------|-----------------------------------|
| `name`        | string  | Yes      | Filter name                       |
| `filter_type` | string  | Yes      | `include` or `exclude`            |
| `pattern`     | string  | Yes      | Pattern to match (supports regex) |
| `enabled`     | boolean | No       | Whether active (default: true)    |

### Server Groups

| Method | Endpoint                            | Description           |
|--------|-------------------------------------|-----------------------|
| GET    | `/api/m3u/server-groups/`           | List server groups    |
| POST   | `/api/m3u/server-groups/`           | Create server group   |
| GET    | `/api/m3u/server-groups/{id}/`      | Get server group      |
| PUT    | `/api/m3u/server-groups/{id}/`      | Update server group   |
| DELETE | `/api/m3u/server-groups/{id}/`      | Delete server group   |

### M3U Refresh

| Method | Endpoint                                 | Description                       |
|--------|------------------------------------------|-----------------------------------|
| POST   | `/api/m3u/refresh/`                      | Refresh all active M3U accounts   |
| POST   | `/api/m3u/refresh/{id}/`                 | Refresh single M3U account        |
| POST   | `/api/m3u/refresh-account-info/{pid}/`   | Refresh account info for profile  |

**Single account refresh response:**

| Field             | Type    | Description                |
|-------------------|---------|----------------------------|
| `status`          | string  | Refresh status             |
| `message`         | string  | Status message             |
| `streams_added`   | integer | New streams added          |
| `streams_updated` | integer | Streams updated            |
| `streams_removed` | integer | Streams removed            |

---

## VOD API

Base path: `/api/vod/`

### Movies

| Method | Endpoint                    | Description      |
|--------|-----------------------------|--------------------|
| GET    | `/api/vod/movies/`          | List movies        |
| POST   | `/api/vod/movies/`          | Create movie       |
| GET    | `/api/vod/movies/{id}/`     | Get movie          |
| PUT    | `/api/vod/movies/{id}/`     | Update movie       |
| DELETE | `/api/vod/movies/{id}/`     | Delete movie       |

**List Movies query parameters:**

| Parameter   | Type    | Description                       |
|-------------|---------|-----------------------------------|
| `page`      | integer | Page number (default: 1)          |
| `page_size` | integer | Items per page (default: 50)      |
| `search`    | string  | Search by title or description    |
| `category`  | integer | Filter by category ID             |
| `year`      | integer | Filter by release year            |
| `rating`    | string  | Filter by rating (PG, PG-13, R)   |

**Movie fields:**

| Field         | Type    | Required | Description          |
|---------------|---------|----------|----------------------|
| `title`       | string  | Yes      | Movie title          |
| `stream_url`  | string  | Yes      | URL to movie stream  |
| `description` | string  | No       | Movie description    |
| `year`        | integer | No       | Release year         |
| `rating`      | string  | No       | Content rating       |
| `duration`    | integer | No       | Duration in minutes  |
| `poster_url`  | string  | No       | Poster image URL     |
| `category_id` | integer | No       | Category ID          |

### Series

| Method | Endpoint                    | Description      |
|--------|-----------------------------|--------------------|
| GET    | `/api/vod/series/`          | List series        |
| POST   | `/api/vod/series/`          | Create series      |
| GET    | `/api/vod/series/{id}/`     | Get series         |
| PUT    | `/api/vod/series/{id}/`     | Update series      |
| DELETE | `/api/vod/series/{id}/`     | Delete series      |

**Series fields:**

| Field           | Type    | Description               |
|-----------------|---------|---------------------------|
| `title`         | string  | Series title              |
| `description`   | string  | Series description        |
| `year`          | integer | First air year            |
| `poster_url`    | string  | Poster image URL          |
| `episode_count` | integer | Total episodes (read-only)|
| `season_count`  | integer | Total seasons (read-only) |

### Episodes

| Method | Endpoint                      | Description        |
|--------|-------------------------------|--------------------|
| GET    | `/api/vod/episodes/`          | List episodes      |
| POST   | `/api/vod/episodes/`          | Create episode     |
| GET    | `/api/vod/episodes/{id}/`     | Get episode        |
| PUT    | `/api/vod/episodes/{id}/`     | Update episode     |
| DELETE | `/api/vod/episodes/{id}/`     | Delete episode     |

**List Episodes query parameters:**

| Parameter | Type    | Description            |
|-----------|---------|------------------------|
| `series`  | integer | Filter by series ID    |
| `season`  | integer | Filter by season number|

**Episode fields:**

| Field         | Type    | Required | Description            |
|---------------|---------|----------|------------------------|
| `title`       | string  | Yes      | Episode title          |
| `series_id`   | integer | Yes      | Parent series ID       |
| `season`      | integer | Yes      | Season number          |
| `episode`     | integer | Yes      | Episode number         |
| `stream_url`  | string  | Yes      | Episode stream URL     |
| `description` | string  | No       | Episode description    |
| `duration`    | integer | No       | Duration in minutes    |

### Categories

| Method | Endpoint                        | Description         |
|--------|---------------------------------|---------------------|
| GET    | `/api/vod/categories/`          | List categories     |
| POST   | `/api/vod/categories/`          | Create category     |
| GET    | `/api/vod/categories/{id}/`     | Get category        |
| PUT    | `/api/vod/categories/{id}/`     | Update category     |
| DELETE | `/api/vod/categories/{id}/`     | Delete category     |

**Category response fields:**

| Field          | Type    | Description                     |
|----------------|---------|---------------------------------|
| `id`           | integer | Category ID                     |
| `name`         | string  | Category name                   |
| `description`  | string  | Category description            |
| `movie_count`  | integer | Number of movies in category    |
| `series_count` | integer | Number of series in category    |

### Unified Content

```
GET /api/vod/all/
```

Returns movies and series in a single list. Supports `search`, `type` (`movie` or `series`), and `category` query parameters.

### VOD Logos

| Method | Endpoint                       | Description        |
|--------|--------------------------------|--------------------|
| GET    | `/api/vod/vodlogos/`           | List VOD logos     |
| POST   | `/api/vod/vodlogos/`           | Create VOD logo    |
| GET    | `/api/vod/vodlogos/{id}/`      | Get VOD logo       |
| PUT    | `/api/vod/vodlogos/{id}/`      | Update VOD logo    |
| DELETE | `/api/vod/vodlogos/{id}/`      | Delete VOD logo    |

---

## Plugins API

Base path: `/api/plugins/`

### Plugins

| Method | Endpoint                                       | Description                  |
|--------|------------------------------------------------|------------------------------|
| GET    | `/api/plugins/plugins/`                        | List all installed plugins   |
| POST   | `/api/plugins/plugins/reload/`                 | Reload plugins from disk     |
| POST   | `/api/plugins/plugins/import/`                 | Import plugin from ZIP file  |
| DELETE | `/api/plugins/plugins/{key}/delete/`           | Delete a plugin              |

**Plugin response fields:**

| Field          | Type    | Description                        |
|----------------|---------|------------------------------------|
| `key`          | string  | Unique plugin identifier           |
| `name`         | string  | Plugin display name                |
| `description`  | string  | Plugin description                 |
| `version`      | string  | Plugin version                     |
| `author`       | string  | Plugin author                      |
| `enabled`      | boolean | Whether plugin is enabled          |
| `has_settings` | boolean | Whether plugin has settings        |
| `logo_url`     | string  | Plugin logo URL                    |

**Import plugin** — send as `multipart/form-data` with a `file` field containing the ZIP.

### Plugin Settings

| Method | Endpoint                                         | Description             |
|--------|--------------------------------------------------|-------------------------|
| GET    | `/api/plugins/plugins/{key}/settings/`           | Get plugin settings     |
| PUT    | `/api/plugins/plugins/{key}/settings/`           | Update plugin settings  |

**Get Settings response:**

| Field    | Type   | Description                         |
|----------|--------|-------------------------------------|
| `schema` | object | Settings schema with field definitions |
| `values` | object | Current setting values              |

### Plugin Execution

```
POST /api/plugins/plugins/{key}/run/
```

Executes a plugin with optional parameters in the request body.

**Response:**

| Field            | Type   | Description                        |
|------------------|--------|------------------------------------|
| `status`         | string | success / running / failed         |
| `message`        | string | Status message                     |
| `result`         | object | Plugin execution result data       |
| `execution_time` | number | Execution time in seconds          |

### Plugin Status

| Method | Endpoint                                       | Description                   |
|--------|-------------------------------------------------|-------------------------------|
| GET    | `/api/plugins/plugins/{key}/enabled/`           | Get enabled status            |
| PUT    | `/api/plugins/plugins/{key}/enabled/`           | Enable or disable plugin      |

**Update enabled body:**

```json
{ "enabled": true }
```

### Plugin Assets

```
GET /api/plugins/plugins/{key}/logo/
```

Returns the plugin's logo image file with appropriate content type.

---

## Additional API Modules

The following modules are also available but not documented in detail here. Explore them via the [Swagger UI](https://dptv.cccp.ps/swagger):

| Module              | Base Path           | Description                         |
|---------------------|---------------------|-------------------------------------|
| Core                | `/api/core/`        | Core settings, user agents, stream profiles |
| HDHomeRun           | `/api/hdhr/`        | HDHomeRun integration endpoints     |
| Backups             | `/api/backups/`     | System backup and restore           |
| Connect             | `/api/connect/`     | Client connection management        |

---

*Generated from the Dispatcharr Swagger documentation at `https://dptv.cccp.ps/swagger`.*
*Source: [Dispatcharr on GitHub](https://github.com/Dispatcharr/Dispatcharr)*
