# @ctrl/plex API Documentation

> A TypeScript [Plex](https://www.plex.tv/) API client using [ofetch](https://github.com/unjs/ofetch), based on [pkkid/python-plexapi](https://github.com/pushingkarmaorg/python-plexapi).

- **Package:** [@ctrl/plex on npm](https://www.npmjs.com/package/@ctrl/plex)
- **Source:** [GitHub](https://github.com/scttcper/plex)
- **TypeDoc:** <https://plex.ep.workers.dev>

---

## Installation

```bash
npm install @ctrl/plex
```

---

## Quick Start

```typescript
import { MyPlexAccount } from '@ctrl/plex';

// Authenticate with username/password or token
const account = await new MyPlexAccount({
  baseUrl: 'http://localhost:32400',
  username: 'username',
  password: 'password',
  // OR: token: 'your-plex-token',
}).connect();

// Connect to a server
const resource = await account.resource('<SERVER_NAME>');
const plex = await resource.connect();
const library = await plex.library();
const sections = await library.sections();
```

---

## Classes

### MyPlexAccount

Plex account and profile information. Represents data from the `plex.tv/users/account` endpoint. Use this as the entry point for authentication.

**Source:** `src/myplex.ts`

#### Constructor

```typescript
new MyPlexAccount(options?: {
  baseUrl?: string;
  username?: string;
  password?: string;
  token?: string;
  server?: PlexServer;
  timeout?: number;
}): MyPlexAccount
```

| Parameter  | Type         | Description                                    |
| ---------- | ------------ | ---------------------------------------------- |
| `baseUrl`  | `string`     | Base URL of your Plex server.                  |
| `username` | `string`     | Plex account username/email.                   |
| `password` | `string`     | Plex account password.                         |
| `token`    | `string`     | Plex auth token (alternative to user/pass).    |
| `server`   | `PlexServer` | Existing PlexServer instance (optional).       |
| `timeout`  | `number`     | Request timeout in ms (default `30000`).       |

#### Properties

| Property               | Type                     | Description                                        |
| ---------------------- | ------------------------ | -------------------------------------------------- |
| `id`                   | `number?`                | Your Plex account ID.                              |
| `uuid`                 | `string?`                | Account UUID.                                      |
| `email`                | `string?`                | Your current Plex email address.                   |
| `title`                | `string?`                | Alias for username.                                |
| `username`             | `string?`                | Account username.                                  |
| `authenticationToken`  | `string?`                | Auth token assigned by Plex.                       |
| `thumb`                | `string?`                | URL of your account thumbnail.                     |
| `locale`               | `string?`                | Your Plex locale.                                  |
| `guest`                | `boolean?`               | Whether the account is a guest.                    |
| `home`                 | `boolean?`               | Whether home sharing is enabled.                   |
| `homeSize`             | `number?`                | Number of home users.                              |
| `maxHomeSize`          | `number?`                | Maximum home user slots.                           |
| `mailingListStatus`    | `"active" \| "inactive"` | Mailing list status.                               |
| `queueEmail`           | `string?`                | Email for adding items to Watch Later queue.       |
| `restricted`           | `boolean?`               | Whether the account is restricted.                 |
| `subscriptionActive`   | `boolean?`               | Whether your Plex subscription is active.          |
| `subscriptionPlan`     | `string?`                | Name of your subscription plan.                    |
| `subscriptionStatus`   | `"active" \| "inactive"` | String representation of subscription state.       |
| `subscriptionFeatures` | `string[]?`              | List of features allowed on your subscription.     |
| `entitlements`         | `string[]?`              | List of devices you can use with this account.     |
| `certificateVersion`   | `number?`                | Certificate version number.                        |
| `scrobbleTypes`        | `string?`                | Scrobble types description.                        |

#### Methods

| Method                                                       | Returns                       | Description                                                                                              |
| ------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `connect()`                                                  | `Promise<MyPlexAccount>`      | Authenticates and returns the connected account. Prioritizes local connections, then HTTPS.               |
| `resource(name: string)`                                     | `Promise<MyPlexResource>`     | Returns the resource matching the given name.                                                            |
| `resources()`                                                | `Promise<MyPlexResource[]>`   | Returns all resources (servers) attached to your account.                                                |
| `device(name?: string, clientId?: string)`                   | `Promise<MyPlexDevice>`       | Returns a device matching name or clientIdentifier.                                                      |
| `devices()`                                                  | `Promise<MyPlexDevice[]>`     | Returns all devices connected to the server.                                                             |
| `claimToken()`                                               | `Promise<string>`             | Returns a new claim token for registering a Plex Server instance to your account.                        |
| `claimServer(token: string)`                                 | `Promise<any>`                | Claims a server using the token from `claimToken()`.                                                     |
| `query<T>(options)`                                          | `Promise<T>`                  | Executes an HTTP request to Plex (see below).                                                            |
| `static getWebLogin(forwardUrl?: string)`                    | `Promise<WebLogin>`           | Initiates web-based login flow. Returns a URI to present to the user.                                    |
| `static webLoginCheck(webLogin, options?)`                   | `Promise<MyPlexAccount>`      | Polls Plex to check if the user completed web login. Returns connected account or throws.                |

**`query()` options:**

```typescript
{
  url: string;
  method?: 'get' | 'post' | 'put' | 'patch' | 'head' | 'delete';
  headers?: any;
  username?: string;
  password?: string;
}
```

---

### PlexServer

Main entry point for interacting with a Plex server. Allows listing clients, browsing library sections, managing butler tasks, viewing sessions, and more.

**Source:** `src/server.ts`

#### Constructor

```typescript
new PlexServer(baseurl: string, token: string, timeout?: number): PlexServer
```

| Parameter | Type     | Default | Description                          |
| --------- | -------- | ------- | ------------------------------------ |
| `baseurl` | `string` | —       | HTTP(S) URL of the Plex server.      |
| `token`   | `string` | —       | Plex authentication token.           |
| `timeout` | `number` | `30000` | Request timeout in milliseconds.     |

#### Key Properties

| Property                       | Type       | Description                                           |
| ------------------------------ | ---------- | ----------------------------------------------------- |
| `friendlyName`                 | `string`   | Human-friendly server name.                           |
| `machineIdentifier`            | `string?`  | Unique server ID (MD5-like).                          |
| `version`                      | `string`   | Current Plex version.                                 |
| `platform`                     | `string`   | Host platform (e.g. `"Linux"`).                       |
| `platformVersion`              | `string`   | Platform version string.                              |
| `myPlexUsername`                | `string`   | Email address of the logged-in user.                  |
| `myPlexSubscription`           | `boolean`  | Whether the user has a Plex subscription.             |
| `ownerFeatures`                | `string[]` | Features allowed by the server owner.                 |
| `allowCameraUpload`            | `boolean`  | Whether camera upload is allowed.                     |
| `allowMediaDeletion`           | `boolean`  | Whether media deletion is allowed.                    |
| `allowSharing`                 | `boolean`  | Whether sharing is allowed.                           |
| `allowSync`                    | `boolean`  | Whether sync is allowed.                              |
| `transcoderActiveVideoSessions`| `number`   | Number of active video transcode sessions.            |
| `transcoderVideo`              | `boolean`  | Whether video transcoding is available.               |
| `transcoderAudio`              | `boolean`  | Whether audio transcoding is available.               |
| `updatedAt`                    | `number`   | Datetime the server was last updated.                 |

#### Methods

| Method                                                                     | Returns                           | Description                                                                           |
| -------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `connect()`                                                                | `Promise<void>`                   | Connects to the server and loads metadata.                                            |
| `library()`                                                                | `Promise<Library>`                | Returns the server's Library for browsing/searching media.                            |
| `search(query, options?)`                                                  | `Promise<Hub[]>`                  | Hub search across all library content (see details below).                            |
| `history(options?)`                                                        | `Promise<HistoryResult[]>`        | Returns watch history. Fetches in batches for large result sets.                      |
| `sessions()`                                                               | `Promise<any[]>`                  | Returns all active (currently playing) sessions.                                      |
| `transcodeSessions()`                                                      | `Promise<any[]>`                  | Returns all active transcode sessions.                                                |
| `activities()`                                                             | `Promise<Activity[]>`             | Returns all current server activities.                                                |
| `butlerTasks()`                                                            | `Promise<ButlerTask[]>`           | Returns all scheduled maintenance (butler) tasks.                                     |
| `runButlerTask(taskName: string)`                                          | `Promise<void>`                   | Triggers a butler task immediately (e.g. `'BackupDatabase'`).                         |
| `bandwidth(options?)`                                                      | `Promise<StatisticsBandwidth[]>`  | Returns server bandwidth statistics.                                                  |
| `resources()`                                                              | `Promise<StatisticsResources[]>`  | Returns server resource usage statistics (CPU/memory).                                |
| `systemAccounts()`                                                         | `Promise<SystemAccount[]>`        | Returns all system accounts on the server.                                            |
| `systemDevices()`                                                          | `Promise<SystemDevice[]>`         | Returns all system devices on the server.                                             |
| `clients()`                                                                | `Promise<PlexClient[]>`           | Returns all connected clients.                                                        |
| `continueWatching()`                                                       | `Promise<any[]>`                  | Returns items from the Continue Watching hub.                                         |
| `settings()`                                                               | `Promise<Settings>`               | Returns server settings.                                                              |
| `agents(mediaType?)`                                                       | `Promise<Agent[]>`                | Returns available metadata agents.                                                    |
| `optimizedItems()`                                                         | `Promise<Optimized[]>`            | Returns all optimized media items.                                                    |
| `createPlayQueue(item, options?)`                                          | `Promise<PlayQueue>`              | Creates a new PlayQueue from media item(s) or a Playlist.                             |
| `myPlexAccount()`                                                          | `MyPlexAccount`                   | Returns the MyPlexAccount for the current token.                                      |
| `transcodeImage(options)`                                                  | `URL`                             | Returns a URL to a transcoded image.                                                  |
| `url(key, options?)`                                                       | `URL`                             | Builds a URL with the proper auth token.                                              |
| `query<T>(options)`                                                        | `Promise<T>`                      | Executes an HTTP request to the Plex server.                                          |

**`search()` options:**

```typescript
search(query: string, options?: {
  limit?: number;
  mediatype?: 'movie' | 'show' | 'season' | 'episode' | 'artist' | 'album'
    | 'track' | 'collection' | 'playlist' | 'person' | 'clip' | 'photo'
    | 'photoalbum' | 'trailer' | 'comic' | 'picture' | 'playlistFolder'
    | 'optimizedVersion' | 'userPlaylistItem';
}): Promise<Hub[]>
```

**`query()` options:**

```typescript
{
  path: string;
  method?: 'get' | 'post' | 'put' | 'patch' | 'head' | 'delete';
  headers?: Record<string, string>;
  body?: Uint8Array;
  username?: string;
  password?: string;
}
```

---

### Library

Represents the Plex library. Provides access to sections, on-deck items, and library management.

**Source:** `src/library.ts`

#### Properties

| Property         | Type     | Description                                |
| ---------------- | -------- | ------------------------------------------ |
| `identifier`     | `string` | Library identifier.                        |
| `mediaTagPrefix` | `string` | Media tag prefix path.                     |
| `title1`         | `string` | Primary title (usually `"Plex Library"`).  |
| `title2`         | `string` | Secondary title.                           |
| `key`            | `string` | Static: `"/library"`.                      |

#### Methods

| Method                                                       | Returns              | Description                                                                    |
| ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------ |
| `sections()`                                                 | `Promise<Section[]>` | Returns all library sections (Movies, TV Shows, Music, etc.).                  |
| `section<T>(title: string)`                                  | `Promise<T>`         | Returns a single section by title. Use a generic for type narrowing.           |
| `sectionByID<T>(sectionId: string \| number)`                | `Promise<T>`         | Returns a single section by its numeric ID.                                    |
| `all()`                                                      | `Promise<any[]>`     | Returns all media items from all sections. May be very large.                  |
| `onDeck()`                                                   | `Promise<any[]>`     | Returns all on-deck (in-progress) items from all sections.                     |
| `emptyTrash()`                                               | `Promise<void>`      | Empties the library trash.                                                     |
| `optimize()`                                                 | `Promise<void>`      | Optimizes the server database (cleanup unused/fragmented data).                |
| `add(name, type, agent, scanner, location, language?, extra?)` | `Promise<any>`     | Adds a new library section (see detailed options in source).                   |

**`section()` usage with generics:**

```typescript
import { MovieSection, ShowSection, MusicSection } from '@ctrl/plex';

const movies = await library.section<MovieSection>('Movies');
const shows  = await library.section<ShowSection>('TV Shows');
const music  = await library.section<MusicSection>('Music');
```

---

### LibrarySection

Base class for all library section types. Extended by `MovieSection`, `ShowSection`, and `MusicSection`.

**Source:** `src/library.ts`

#### Section Types

| Class          | Content Type | Description              |
| -------------- | ------------ | ------------------------ |
| `MovieSection` | `movie`      | Movies library section.  |
| `ShowSection`  | `show`       | TV Shows library section.|
| `MusicSection` | `artist`     | Music library section.   |

#### Common Section Methods

| Method                          | Returns          | Description                                                     |
| ------------------------------- | ---------------- | --------------------------------------------------------------- |
| `search(options?)`              | `Promise<any[]>` | Search within this section with filters.                        |
| `all()`                         | `Promise<any[]>` | Returns all items in the section.                               |
| `onDeck()`                      | `Promise<any[]>` | Returns on-deck items from this section.                        |
| `recentlyAdded()`               | `Promise<any[]>` | Returns recently added items.                                   |

**Search examples:**

```typescript
// List all unwatched movies
const section = await library.section<MovieSection>('Movies');
const unwatched = await section.search({ unwatched: true });

// Search by title
const results = await section.search({ title: 'Rush Hour' });

// List episodes of a show
const shows = await library.section<ShowSection>('TV Shows');
const results = await shows.search({ title: 'Silicon Valley' });
const episodes = await results[0].episodes();
```

---

### Playlist

Represents a Plex playlist. Extends `Playable`.

**Source:** `src/playlist.ts`

#### Properties

| Property         | Type      | Description                              |
| ---------------- | --------- | ---------------------------------------- |
| `title`          | `string?` | Playlist title.                          |
| `playlistType`   | `string`  | Type of playlist (e.g. `"video"`).       |
| `smart`          | `boolean` | Whether this is a smart playlist.        |
| `summary`        | `string`  | Playlist description.                    |
| `leafCount`      | `number`  | Number of items in the playlist.         |
| `duration`       | `number?` | Total duration in milliseconds.          |
| `durationInSeconds` | `number?` | Total duration in seconds.            |
| `composite`      | `string`  | URL of the playlist composite image.     |
| `guid`           | `string`  | Playlist GUID.                           |
| `addedAt`        | `Date`    | When the playlist was created.           |
| `updatedAt`      | `Date`    | When the playlist was last updated.      |
| `ratingKey`      | `string?` | Rating key identifier.                   |
| `allowSync`      | `boolean?`| Whether sync is allowed.                 |

#### Methods

| Method                                     | Returns          | Description                                           |
| ------------------------------------------ | ---------------- | ----------------------------------------------------- |
| `items()`                                  | `Promise<any[]>` | Returns all items in the playlist.                    |
| `item(title: string)`                      | `Promise<any>`   | Returns a single item by title.                       |
| `addItems(items)`                          | `Promise<void>`  | Adds items to the playlist.                           |
| `removeItems(items)`                       | `Promise<void>`  | Removes items from the playlist.                      |
| `delete()`                                 | `Promise<void>`  | Deletes the playlist.                                 |
| `edit(options)`                             | `Promise<void>`  | Edits playlist metadata.                              |
| `editTitle(title)`                         | `Promise<void>`  | Updates the playlist title.                           |
| `editSummary(summary)`                     | `Promise<void>`  | Updates the playlist summary.                         |
| `editSortTitle(sortTitle)`                 | `Promise<void>`  | Updates the sort title.                               |
| `section()`                                | `Promise<any>`   | Returns the library section for this playlist.        |
| `static create(server, title, options)`    | `Promise<Playlist>` | Creates a new playlist on the server.              |
| `static update(server, ratingKey, options)` | `Promise<any>`  | Updates an existing playlist.                         |

**Creating a playlist:**

```typescript
import { Playlist } from '@ctrl/plex';

const topMovies = await section.search({ sort: 'rating' });
const playlist = await Playlist.create(plex, 'Best Movies', { items: topMovies });
```

---

### PlexClient

Represents a Plex client device connected to the server.

**Source:** `src/client.ts`

#### Constructor

```typescript
new PlexClient(options?: PlexOptions): PlexClient
```

---

### MyPlexResource

Represents a server resource attached to a Plex account.

**Source:** `src/myplex.ts`

#### Key Methods

| Method      | Returns              | Description                                           |
| ----------- | -------------------- | ----------------------------------------------------- |
| `connect()` | `Promise<PlexServer>` | Connects to this resource and returns a PlexServer.   |

---

### MyPlexDevice

Represents a device connected to a Plex account.

**Source:** `src/myplex.ts`

---

## Media Classes

### Movie

Represents a movie in the Plex library.

### Show

Represents a TV show in the Plex library.

#### Key Methods

| Method       | Returns              | Description                      |
| ------------ | -------------------- | -------------------------------- |
| `episodes()` | `Promise<Episode[]>` | Returns all episodes of the show.|
| `seasons()`  | `Promise<Season[]>`  | Returns all seasons of the show. |

### Season

Represents a season of a TV show.

#### Key Methods

| Method       | Returns              | Description                           |
| ------------ | -------------------- | ------------------------------------- |
| `episodes()` | `Promise<Episode[]>` | Returns all episodes in this season.  |
| `show()`     | `Promise<Show>`      | Returns the parent Show.              |

### Episode

Represents a single TV episode.

### Artist

Represents a music artist in the Plex library.

### Album

Represents a music album.

### Track

Represents a music track.

### Collection

Represents a Plex collection.

### Clip

Represents a video clip.

---

## Media Metadata Classes

| Class              | Description                                    |
| ------------------ | ---------------------------------------------- |
| `Media`            | Media container with file info and streams.    |
| `MediaPart`        | Individual media file (part of a `Media`).     |
| `MediaPartStream`  | Base stream class.                             |
| `AudioStream`      | Audio stream metadata.                         |
| `SubtitleStream`   | Subtitle stream metadata.                      |
| `LyricStream`      | Lyric stream metadata.                         |
| `VideoStream`      | (via `MediaPartStream`)                        |
| `Chapter`          | Chapter marker in a media item.                |
| `Marker`           | Intro/credits marker.                          |
| `Optimized`        | Optimized version of a media item.             |

---

## Tag Classes

| Class         | Description                   |
| ------------- | ----------------------------- |
| `Genre`       | Genre tag.                    |
| `Director`    | Director tag.                 |
| `Writer`      | Writer tag.                   |
| `Producer`    | Producer tag.                 |
| `Role`        | Actor/role tag.               |
| `Country`     | Country tag.                  |
| `Similar`     | Similar content tag.          |
| `Mood`        | Mood tag.                     |
| `Style`       | Style tag.                    |
| `Label`       | Label tag.                    |
| `Format`      | Format tag.                   |
| `Subformat`   | Subformat tag.                |
| `Guid`        | GUID (external ID) tag.       |
| `Rating`      | Rating tag.                   |

---

## Visual Assets

| Class    | Description                          |
| -------- | ------------------------------------ |
| `Art`    | Background art for a media item.     |
| `Poster` | Poster image for a media item.      |
| `Theme`  | Theme music for a media item.        |
| `Image`  | Generic image.                       |

---

## Server Management Classes

| Class                  | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `Activity`             | A server activity (scan, optimize, etc.).       |
| `Agent`                | A metadata agent.                               |
| `ButlerTask`           | A scheduled maintenance task.                   |
| `StatisticsBandwidth`  | Server bandwidth statistics.                    |
| `StatisticsResources`  | Server resource usage (CPU/memory) stats.       |
| `SystemAccount`        | A system-level account on the server.           |
| `SystemDevice`         | A system-level device on the server.            |

---

## Browsing & Search Classes

| Class              | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `Hub`              | A search result hub/category (movie, actor, etc.).    |
| `SearchResult`     | A search result item.                                 |
| `FilterChoice`     | A filter option value.                                |
| `FilteringField`   | A filterable field.                                   |
| `FilteringFieldType` | The data type of a filtering field.                 |
| `FilteringFilter`  | An active filter.                                     |
| `FilteringOperator` | A filter comparison operator.                        |
| `FilteringSort`    | A sort option.                                        |
| `FilteringType`    | A filtering type grouping.                            |
| `FirstCharacter`   | A first-character entry for alphabetical browsing.    |
| `Folder`           | A file/folder in the library.                         |

---

## Playback Classes

| Class            | Description                                   |
| ---------------- | --------------------------------------------- |
| `PlayQueue`      | A play queue for media playback.              |
| `ClientTimeline` | Timeline data from a connected client.        |
| `AlertListener`  | Listens for server alert events.              |

---

## Interfaces

### PlexOptions

Options for constructing a `PlexClient`.

```typescript
interface PlexOptions {
  server?: PlexServer;    // PlexServer this client is connected to
  data?: any;             // Response data used to build this object
  initpath?: string;      // Path used to generate data
  baseurl?: string;       // HTTP URL to connect to this client
  token?: string;         // X-Plex-Token for authentication
  session?: string;       // Request session object
  timeout?: number;       // Timeout in seconds (default: TIMEOUT)
}
```

### BandwidthOptions

Options for filtering bandwidth statistics.

### HistoryResult

Represents a single watch history entry.

### PlayMediaOptions

Options for playing media on a client.

### TranscodeImageOptions

Options for generating a transcoded image URL.

### UpdatePlaylistOptions

Options for updating a playlist.

### SendCommandParams

Parameters for sending a command to a client.

### SetParametersOptions

Options for setting playback parameters.

### SetStreamsOptions

Options for setting active streams.

### ClientTimelineData

Raw timeline data from a client.

---

## Type Aliases

| Type          | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `Section`     | Union type: `MovieSection \| ShowSection \| MusicSection`.      |
| `SectionType` | Section type identifier.                                        |
| `AlertTypes`  | Alert event type identifiers.                                   |

---

## Constants

| Variable            | Description                                        |
| ------------------- | -------------------------------------------------- |
| `SEARCHTYPES`       | Map of search type identifiers to their values.    |
| `X_PLEX_IDENTIFIER` | Default X-Plex client identifier string.           |

---

## Error Classes

| Class          | Description                               |
| -------------- | ----------------------------------------- |
| `BadRequest`   | Thrown on HTTP 400 responses.             |
| `NotFound`     | Thrown on HTTP 404 responses.             |
| `Unauthorized` | Thrown on HTTP 401 responses.             |
| `UnknownType`  | Thrown when an unknown media type is returned. |
| `Unsupported`  | Thrown for unsupported operations.        |

---

## Usage Examples

### List all unwatched movies

```typescript
import { MovieSection } from '@ctrl/plex';

const section = await library.section<MovieSection>('Movies');
const results = await section.search({ unwatched: true });
```

### Search for movies by title

```typescript
const section = await library.section<MovieSection>('Movies');
const results = await section.search({ title: 'Rush Hour' });
```

### Global search across all content

```typescript
const results = await plex.search('Arnold');
for (const hub of results) {
  console.log(hub?.Metadata?.[0]);
}
```

### List all episodes of a TV show

```typescript
import { ShowSection } from '@ctrl/plex';

const section = await library.section<ShowSection>('TV Shows');
const results = await section.search({ title: 'Silicon Valley' });
const episodes = await results[0].episodes();
```

### Create a playlist

```typescript
import { Playlist } from '@ctrl/plex';

const topMovies = await section.search({ sort: 'rating' });
const playlist = await Playlist.create(plex, 'Best Movies', { items: topMovies });
```

### Web-based login flow

```typescript
import { MyPlexAccount } from '@ctrl/plex';

// Step 1: Get login URI
const webLogin = await MyPlexAccount.getWebLogin('https://yourapp.com/callback');
// Present webLogin.uri to the user in a browser

// Step 2: Poll for completion
const account = await MyPlexAccount.webLoginCheck(webLogin, { timeoutSeconds: 120 });
```

---

## Notes

- All async methods return Promises and must be awaited.
- Constructors in JS/TS do not make requests — call `.connect()` after instantiation.
- Property access cannot trigger requests — use the corresponding method instead.
- This library is based on the Python `plexapi` package, but adapted for TypeScript/JavaScript idioms.
