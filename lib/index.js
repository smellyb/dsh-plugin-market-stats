/**
 * Host half of dsh-plugin-market-stats.
 *
 * The browser half does all of the work: it reads the configured market indexes
 * through the official `pluginMarket` remote, joins them with the community feed
 * that carries stars and download counts, and renders the result as its own tab
 * on the Plugins page.
 *
 * This half exists because a package's browser bundle is mounted on the loader
 * row that resolves to its own manifest: without a mounted host row the client
 * bundle is never served. It registers no service, no tool, no route and no
 * settings section, so the row costs nothing at runtime.
 */

/** Mount the (inert) host face; the browser half lives in `./client`. */
export function apply() {}
