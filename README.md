# Univelop for Stream Deck

Stream Deck plugin that talks to the [Univelop API v2](https://app.univelop.de/api/v2/docs).

| Action | What a key press does |
|---|---|
| **Open in Univelop** | Opens a list or tile, Kanban board, single record, the workspace home or the workflow log in the browser. |
| **Run workflow** | Triggers a workflow with an optional JSON payload. It can wait for the result and show a field of the return value on the key, e.g. the number of open tickets. |
| **Create record / timer** | Creates a record with preset default values. **Timer mode:** the first press creates the record (e.g. a time entry with start = now) and the key shows a running timer. The second press updates the same record with the stop values (e.g. end = now). |

The settings are built from the workspace **schema** (`GET /api/v2/workspaces/{id}/schema`). You pick lists from a dropdown, and the default-values editor shows the list's fields with suitable inputs:

- status and dropdown options
- multi-select checkboxes
- searchable record pickers for linked lists
- date and time placeholders

## Setup

1. Install the plugin: double-click `de.univelop.streamdeck.streamDeckPlugin` (see *Build* below).
2. Drag any Univelop action onto a key and open the **Univelop connection** panel:
   - **API key:** created in the Univelop workspace settings → API.
   - **Workspace ID:** paste the ID or any workspace URL (`…/#/ws/<id>/…`).
   - **Environment:** Production, the Beta app, Development or a custom domain.
   - Click **Test connection**.

The connection is stored once in the plugin's global settings and shared by all keys.

> Reading the schema needs an **admin or owner** API key. Every API call uses Univelop API credits. The plugin caches the schema for 5 minutes, and the settings panel caches record lookups.

## Time tracking in 30 seconds

1. Add **Create record / timer** and select your time-tracking list.
2. Click **⏱ Time tracking**. The preset detects date, start and end fields:
   - Date = `{{today}}`
   - Start = `{{time|round15}}`
   - On stop: End = `{{time|round15}}`
3. Add fixed values, e.g. *Project* = "Internal" (record picker) and *Description*.
4. Use **Preview request** to see the exact API calls.

Press once to start and again to stop. The running timer survives Stream Deck restarts. If the timer gets stuck, **Reset running timer** in the settings clears it.

## Placeholders

They work in default values, the raw JSON fields and workflow payloads. They are evaluated when the key is pressed.

| Placeholder | Example result |
|---|---|
| `{{now}}` | `2026-11-27T08:15:00.000Z` (ISO, UTC) |
| `{{today}}` | `2026-11-27T00:00:00.000Z` (Univelop date value) |
| `{{date}}` / `{{time}}` / `{{datetime}}` | `2026-11-27` / `09:15` / `2026-11-27 09:15` (local) |
| `{{timestamp}}` / `{{weekday}}` | epoch ms / 1 (Mon) … 7 (Sun) |
| Offsets | `{{now+30m}}`, `{{today-1d}}`, `{{time+1h}}` (units `m h d w`) |
| Rounding (minutes) | `{{time|round15}}`, `{{now|floor5}}`, `{{now|ceil30}}` |

## How fields are written

Write keys follow the API v2 conventions. Each field's suggested key can be changed under **API key** if a brick needs a different one.

| Brick | Key | Value |
|---|---|---|
| Record picker / multi record picker | `<name>` | id / array of ids |
| Dropdown / status / segments | `<name>_id` | option techName |
| Multi selection | `<name>_ids` | array of option techNames |
| Date range | `<name>_start`, `<name>_end` | ISO dates, flat |
| Everything else | `<name>` | text / number / boolean |

Fields the schema marks as computed (expressions), plus file, image and layout bricks, are not offered. **Custom key…** and **Advanced: raw JSON** cover any other write.

## Limitations

- **Workflows:** the API has no endpoint that lists workflows, so you enter the technical name or ID. **Check** looks up the last execution, and names you have used are suggested. The workflow needs an API (webhook) trigger. Set **Trigger step** if it has several.
- **Tiles:** the schema returns lists but not tiles. To apply a tile's filter and sorting, paste its `tileSpecId` into **Open in Univelop**.
- **Brick types:** the schema reports them as display names, so the field mapping uses pattern matching on those names. Unknown bricks appear under *Other bricks (unverified)*.

## Development

```bash
npm install
npm run build        # bundles src/ → de.univelop.streamdeck.sdPlugin/bin/plugin.js
npm test             # unit tests (placeholders, field mapping, deep links)
npm run e2e          # fake Stream Deck + mock API + real settings UIs in Chromium (needs Playwright)
npm run pack         # → dist/de.univelop.streamdeck.streamDeckPlugin
```

### Releases

GitHub Actions builds, tests and packs the plugin, then attaches `de.univelop.streamdeck-vX.Y.Z.streamDeckPlugin` to a GitHub release. There are two ways to start it:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

You can also go to **Actions → Release → Run workflow** and enter `0.2.0`. This creates the tag on the selected branch's commit.

The version is written into the packaged manifest as `0.2.0.0`. Stream Deck only accepts numeric versions, so `v1.2.3` and `v1.2.3.4` are valid but `v1.0.0-beta` is not. Every other push and pull request runs CI: typecheck, tests, build and manifest validation.

For live development, link the plugin into Stream Deck (`npx streamdeck link de.univelop.streamdeck.sdPlugin`) and run `npm run watch`.

```
src/
  plugin.ts                 entry, registers actions
  actions/                  open-tile, run-workflow, create-record (timer)
  lib/univelop-api.ts       API v2 client (x-api-key)
  lib/connection.ts         global settings, schema cache, settings-UI request handlers
  lib/fields.ts             schema bricks → form fields → API payload
  lib/template.ts           {{placeholders}}
  lib/links.ts              app deep links (#/ws/<ws>/records-list/<listId>…)
de.univelop.streamdeck.sdPlugin/
  manifest.json
  ui/                       settings UIs (no external dependencies), pi.js = shared runtime
  imgs/                     rendered from assets/icons via `npm run icons`
```

The API key is stored in Stream Deck's global plugin settings. The plugin never logs it: the log level is fixed to `info` because `trace` would record the settings messages.
