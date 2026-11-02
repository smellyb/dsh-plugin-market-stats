# dsh-plugin-market-stats

A **Stats** tab for the DeepSeek Harness Plugins page: GitHub stars and npm
downloads for every plugin the configured market index lists.

[中文](README.zh.md)

## Why it exists

The plugin market index format 1 defines `name`, `title`, `description`, `icon`,
`author`, `homepage`, `repository`, `metadata` and `versions` — and nothing
about popularity. The Discover tab therefore cannot show how widely used a
plugin is, and picking between two plugins with identical descriptions comes
down to guesswork.

This plugin adds a second tab next to **Discover** that shows the numbers. It
does not modify the official page, does not patch DSH, and installs nothing.

## What it shows

| Column | Meaning |
|---|---|
| Name | The npm package name; when the plugin declares a GitHub repository the name links to it. A badge marks plugins that are already installed (`installed`, `update-available`, …). |
| Stars | GitHub stars of the declared repository. |
| Downloads | npm downloads for the trailing 30 days (7 days for plugins the community catalog does not list). |

The toolbar filters by package name and sorts by stars, downloads, name, or the
index's own order. The table renders 50 rows at a time and grows by 50.

## Where the numbers come from

Nothing is measured by this plugin itself; it joins three public sources in the
browser:

1. **The configured market index** (Plugins → Discover → Index sources) for the
   plugin list. The index is read directly with `fetch` when the browser is
   allowed to (every known index answers with `access-control-allow-origin: *`),
   and otherwise page by page through the Host's own `pluginMarket.search`, so a
   CORS-less index still works.
2. **`https://awesome-dsh-plugin.com/plugins.json`** — the community catalog the
   same ecosystem publishes daily. Each entry carries `stars`, `downloads`
   (trailing 30 days), the npm package name and the GitHub URL. This is one
   request for the whole catalog and covers ~95% of the index. It is *not* a
   format-1 index (it has no `format` field), so it cannot be used as an index
   source, but it is the cheapest source of stars that exists.
3. **`api.github.com` and `api.npmjs.org`** for whatever the catalog misses:
   npm's bulk downloads endpoint (128 packages per request) plus up to 40
   GitHub repository lookups per load. Unauthenticated GitHub allows 60
   requests per hour per IP, which is why the budget is capped.

All three endpoints are fetched by the browser; no Host route, token, proxy or
credential is involved, and nothing is written to disk.

## Install

```sh
dsh plugin --profile desktop add dsh-plugin-market-stats
```

Or from a local checkout:

```sh
dsh plugin --profile desktop add link:/path/to/dsh-plugin-market-stats
```

Restart the profile (or let HMR pick the row up), then open **Plugins** and
select the **Stats** tab.

## Requirements

- DSH `>=0.2.1-rc.5` (the Discover tab and the `pluginMarket` service).
- At least one index source configured under Discover → Index sources.
  `https://cdn.jsdmirror.com/npm/dsh-plugin-catalog/index.json` is the fastest
  one measured on a mainland-China network.
- Outbound HTTPS to `awesome-dsh-plugin.com`, `api.github.com` and
  `api.npmjs.org`. Without them the tab still lists plugins, with `—` in both
  numeric columns.

## Notes and limits

- **Stars are a repository property, downloads are a package property.** A
  monorepo that publishes twenty plugins shows the same star count for all
  twenty; that is the correct reading, not a bug.
- **The catalog lags.** It is rebuilt daily, so a plugin published an hour ago
  shows `—` until the next build. Pressing **Refresh** re-reads everything.
- **GitHub's anonymous rate limit** (60/hour) is shared by every consumer of
  that IP. The tab stops asking after 40 lookups per load and keeps whatever it
  already has.
- **No caching between sessions.** A page reload re-reads the index and the
  catalog (about 12 MB, mostly the catalog). The tab is a deliberate
  read-through: a stale popularity number is worse than a slow one.
- The tab is read-only: it never installs, enables or removes a plugin.

## Layout

```
package.json        manifest: dsh.bundle.patch + dsh.client (platform web)
cordis.patch.yml    inserts the row `plugin-market-stats`
lib/index.js        host half: inert, exists so the client bundle is served
lib/client.js       browser half: the Stats tab (slot `plugins.tab`, id `marketStats`)
test/smoke.mjs      self-check: loads the bundle, asserts helpers, joins a live index
locale/{zh,en}.json package display metadata
icon.svg            tab/plugin icon
```

The host half registers no service, tool, route or settings section; the row is
only a mount point for the browser bundle, which the client module host serves
for the loader row that resolves to this package's own manifest.

## Self-check

```sh
npm test              # helpers + a live join against the real index (~2 s)
npm run test:offline  # helpers + the Host-fallback path, no network
```

