window.__ModuleLoader__.load({
	id: "dsh-plugin-market-stats",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		//#region src/client/index.js
		/**
		 * Market stats — browser half.
		 *
		 * Adds a **Stats** tab to the Plugins page showing, for every plugin the
		 * configured market indexes list, its GitHub stars and its npm download
		 * count.
		 *
		 * Where the numbers come from:
		 *
		 *  - A format-1 index carries no popularity data: it defines name, title,
		 *    description, icon, author, homepage, repository, category, keywords,
		 *    labels, sortKeys and versions, nothing else. The tab reads the index
		 *    for the plugin list only.
		 *  - `https://awesome-dsh-plugin.com/plugins.json` is the community feed
		 *    the same ecosystem publishes daily. Each entry carries `stars`,
		 *    `downloads` (trailing 30 days), the npm name and the GitHub URL. It
		 *    is a plain list (no `format: 1`), so it cannot be an index source,
		 *    but it is the cheapest way to get stars for thousands of plugins in
		 *    one request.
		 *  - Plugins the feed has never seen fall back to the two public APIs:
		 *    `api.github.com/repos/<owner>/<repo>` and npm's bulk downloads
		 *    endpoint.
		 *
		 * Everything runs in the browser: all three endpoints answer with
		 * `access-control-allow-origin: *`, so no Host route, token or proxy is
		 * involved. An index the browser may not fetch is paged through the
		 * Host's own `pluginMarket.search` instead.
		 */
		/** Dictionary namespace owned by this plugin. */
		const NS = "marketStats";
		/**
		 * Cordis services this plugin reads.
		 *
		 * `remote.pluginMarket` is deliberately NOT injected: a hard dependency
		 * would park the whole plugin when the optional market bundle is off.
		 * It is resolved with `ctx.get()` on every load instead, and
		 * `ctx.inject()` re-runs the load when the service shows up later.
		 */
		const inject = ["slots", "locale"];
		/** The market service this tab reads. */
		const MARKET = "remote.pluginMarket";
		/** Community feed carrying stars and downloads; a plain list, not a format-1 index. */
		const FEED_URL = "https://awesome-dsh-plugin.com/plugins.json";
		/** Largest page `pluginMarket.search` accepts. */
		const PAGE_LIMIT = 100;
		/** npm's bulk downloads endpoint refuses more than 128 names per request. */
		const NPM_BULK_LIMIT = 128;
		/** Per-load budget for GitHub lookups of plugins the feed does not list. */
		const GITHUB_BUDGET = 40;
		/** Per-load budget for single scoped-package npm lookups (the bulk endpoint rejects them). */
		const SCOPED_BUDGET = 40;
		/** Rows rendered before "Show more". */
		const RENDER_STEP = 50;
		const zh = {
			title: "数据",
			loading: "正在读取插件数据",
			refresh: "刷新",
			retry: "重试",
			noIndex: "还没有插件市场索引源",
			noIndexHint: "先在「发现 → 索引源」添加一个索引，这里才有可统计的插件。",
			noMarket: "插件市场服务未启用",
			noMarketHint: "启用「自定义插件市场」组合包后，这个标签页才有索引可读。",
			failed: "无法读取插件数据",
			search: "搜索插件",
			searchPlaceholder: "按包名筛选",
			sort: "排序",
			sortStars: "星标",
			sortDownloads: "下载量",
			sortName: "名称",
			sortDefault: "默认顺序",
			stars: "星标",
			downloads: "下载",
			none: "—",
			window30d: "近 30 天下载",
			window7d: "近 7 天下载",
			feedNote: "星标与下载来自社区目录（{date} 更新），未收录的插件直接查询 GitHub 与 npm。",
			count: "共 {count} 个插件",
			filtered: "筛选后 {count} 个",
			loadMore: "显示更多",
			openRepo: "打开仓库",
			emptyFilter: "没有匹配的插件",
		};
		const en = {
			title: "Stats",
			loading: "Reading plugin data",
			refresh: "Refresh",
			retry: "Retry",
			noIndex: "No plugin market index yet",
			noIndexHint: "Add one under Discover → Index sources to have plugins to measure.",
			noMarket: "The plugin market service is not enabled",
			noMarketHint: "Enable the custom plugin market bundle to give this tab an index to read.",
			failed: "Could not read plugin data",
			search: "Search plugins",
			searchPlaceholder: "Filter by package name",
			sort: "Sort",
			sortStars: "Stars",
			sortDownloads: "Downloads",
			sortName: "Name",
			sortDefault: "Default order",
			stars: "Stars",
			downloads: "Downloads",
			none: "—",
			window30d: "Downloads, last 30 days",
			window7d: "Downloads, last 7 days",
			feedNote: "Stars and downloads come from the community catalog (updated {date}); plugins it does not list are queried on GitHub and npm directly.",
			count: "{count} plugins",
			filtered: "{count} after filtering",
			loadMore: "Show more",
			openRepo: "Open repository",
			emptyFilter: "No matching plugins",
		};
		/** Normalize a GitHub URL to `owner/repo` (lowercase), or null. */
		function repoKey(url) {
			if (typeof url !== "string") return null;
			const match = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(url);
			if (match === null) return null;
			return `${match[1]}/${match[2]}`.replace(/\.git$/i, "").toLowerCase();
		}
		/** Format a count as 999 / 1.2k / 34k / 1.2M. */
		function compact(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return null;
			if (value < 1000) return String(value);
			if (value < 1e6) {
				const thousands = value / 1000;
				return `${(thousands < 10 ? thousands.toFixed(1) : String(Math.round(thousands))).replace(/\.0$/, "")}k`;
			}
			return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
		}
		/** Read one localized format-1 field (a literal string or a language map). */
		function localized(value, language) {
			if (typeof value === "string") return value;
			if (value === null || typeof value !== "object") return "";
			return value[language] ?? value.zh ?? value.en ?? Object.values(value)[0] ?? "";
		}
		/** Index a feed payload by npm name and by `owner/repo`. */
		function indexFeed(plugins) {
			const byNpm = new Map();
			const byRepo = new Map();
			for (const plugin of Array.isArray(plugins) ? plugins : []) {
				if (plugin === null || typeof plugin !== "object") continue;
				const record = {
					stars: typeof plugin.stars === "number" ? plugin.stars : null,
					downloads: typeof plugin.downloads === "number" ? plugin.downloads : null,
					window: "30d",
					repo: repoKey(plugin.url),
				};
				if (typeof plugin.npm === "string" && plugin.npm !== "") byNpm.set(plugin.npm.toLowerCase(), record);
				if (record.repo !== null) byRepo.set(record.repo, record);
			}
			return { byNpm, byRepo };
		}
		/** Fetch JSON with an abort signal; throws on a non-2xx answer. */
		async function getJson(url, signal) {
			const response = await fetch(url, {
				signal,
				headers: { accept: "application/json" },
			});
			if (!response.ok) throw new Error(`${url} answered ${response.status}`);
			return response.json();
		}
		/** Read one index document directly (the fast path: one request, CORS permitting). */
		async function readIndexDirect(url, signal) {
			const body = await getJson(url, signal);
			if (body === null || typeof body !== "object" || !Array.isArray(body.plugins)) {
				throw new Error(`${url} is not a format-1 index`);
			}
			return {
				title: localized(body.title, "zh"),
				plugins: body.plugins.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.name === "string"),
			};
		}
		/** Read one index through the Host, page by page (the fallback when the browser cannot fetch it). */
		async function readIndexViaHost(market, url) {
			const plugins = [];
			let offset = 0;
			let fetchedAt;
			let title = "";
			for (;;) {
				const answer = await market.search(url, {
					sort: { kind: "index" },
					offset,
					limit: PAGE_LIMIT,
					...(fetchedAt === undefined ? {} : { fetchedAt }),
				});
				if (!answer.ok) throw new Error(answer.error?.message ?? "pluginMarket.search failed");
				const page = answer.value;
				if (fetchedAt === undefined) {
					fetchedAt = page.fetchedAt;
					title = localized(page.title, "zh");
				}
				for (const entry of page.entries ?? []) plugins.push(entry);
				if (page.nextOffset === null || page.nextOffset === undefined) break;
				offset = page.nextOffset;
			}
			return { title, plugins };
		}
		/**
		 * Query npm for the last-week downloads of the given packages.
		 *
		 * The bulk endpoint refuses scoped names outright ("scoped packages are not
		 * currently supported in bulk lookups") and caps a request at 128 names, so
		 * unscoped names go in batches and each scoped name is asked separately.
		 */
		async function npmDownloads(names, signal) {
			const answer = new Map();
			const unscoped = names.filter((name) => !name.startsWith("@"));
			const scoped = names.filter((name) => name.startsWith("@"));
			for (let offset = 0; offset < unscoped.length; offset += NPM_BULK_LIMIT) {
				const slice = unscoped.slice(offset, offset + NPM_BULK_LIMIT);
				try {
					const body = await getJson(`https://api.npmjs.org/downloads/point/last-week/${slice.map(encodeURIComponent).join(",")}`, signal);
					for (const name of slice) {
						const count = body?.[name]?.downloads;
						if (typeof count === "number") answer.set(name, count);
					}
				} catch {
					/* a failed batch leaves those rows without a download count */
				}
			}
			for (const name of scoped.slice(0, SCOPED_BUDGET)) {
				try {
					const body = await getJson(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`, signal);
					if (typeof body?.downloads === "number") answer.set(name, body.downloads);
				} catch {
					/* unscoped names in the same load are unaffected */
				}
			}
			return answer;
		}
		/** Query GitHub for one repository's stars; null when unavailable or rate limited. */
		async function githubStars(repo, signal) {
			if (repo === null) return null;
			try {
				const body = await getJson(`https://api.github.com/repos/${repo}`, signal);
				return typeof body.stargazers_count === "number" ? body.stargazers_count : null;
			} catch {
				return null;
			}
		}
		/**
		 * Read every configured index and attach popularity data.
		 * @param market - the `pluginMarket` remote service.
		 * @returns the rows, the feed's build date, and the index titles.
		 */
		async function collect(market) {
			const listed = await market.listIndexes();
			if (!listed.ok) throw new Error(listed.error?.message ?? "pluginMarket.listIndexes failed");
			const usable = (listed.value ?? []).filter((index) => index.error === undefined);
			if (usable.length === 0) return { rows: [], updated: null, indexes: [] };

			const controller = new AbortController();
			const entries = [];
			const titles = [];
			for (const index of usable) {
				let document;
				try {
					document = await readIndexDirect(index.url, controller.signal);
				} catch {
					document = await readIndexViaHost(market, index.url);
				}
				titles.push(document.title === "" ? index.url : document.title);
				for (const entry of document.plugins) entries.push(entry);
			}

			// The community feed answers once for the whole catalog.
			const feed = indexFeed([]);
			let updated = null;
			try {
				const body = await getJson(FEED_URL, controller.signal);
				const indexed = indexFeed(body?.plugins);
				for (const [key, value] of indexed.byNpm) feed.byNpm.set(key, value);
				for (const [key, value] of indexed.byRepo) feed.byRepo.set(key, value);
				updated = typeof body?.updated === "string" ? body.updated : null;
			} catch {
				/* the live queries below still produce stars and downloads */
			}

			const repoOf = (entry) => repoKey(entry.repository?.url) ?? repoKey(entry.homepage);
			const uncovered = entries.filter((entry) => {
				const key = entry.name.toLowerCase();
				const repo = repoOf(entry);
				return !feed.byNpm.has(key) && !(repo !== null && feed.byRepo.has(repo));
			});

			const live = new Map();
			if (uncovered.length > 0) {
				const downloads = await npmDownloads(uncovered.map((entry) => entry.name), controller.signal);
				for (const [name, count] of downloads) live.set(name.toLowerCase(), { downloads: count, stars: null });
				let budget = GITHUB_BUDGET;
				for (const entry of uncovered) {
					if (budget <= 0) break;
					const repo = repoOf(entry);
					if (repo === null) continue;
					budget -= 1;
					const stars = await githubStars(repo, controller.signal);
					if (stars === null) continue;
					const key = entry.name.toLowerCase();
					const previous = live.get(key);
					live.set(key, { downloads: previous?.downloads ?? null, stars });
				}
			}

			const rows = entries.map((entry) => {
				const key = entry.name.toLowerCase();
				const repo = repoOf(entry);
				const fromFeed = feed.byNpm.get(key) ?? (repo === null ? undefined : feed.byRepo.get(repo));
				const fromLive = live.get(key);
				const stars = fromFeed?.stars ?? fromLive?.stars ?? null;
				const downloads = fromFeed?.downloads ?? fromLive?.downloads ?? null;
				return {
					name: entry.name,
					title: localized(entry.title, "zh"),
					repo,
					stars,
					downloads,
					window: fromFeed?.downloads != null ? "30d" : fromLive?.downloads != null ? "7d" : null,
					installed: entry.installation?.status ?? null,
				};
			});
			return { rows, updated, indexes: titles };
		}
		/** Sort rows by the selected order; unknown values stay last. */
		function sortRows(rows, order) {
			const known = (value) => (typeof value === "number" ? value : -1);
			const sorted = [...rows];
			if (order === "stars") sorted.sort((left, right) => known(right.stars) - known(left.stars));
			else if (order === "downloads") sorted.sort((left, right) => known(right.downloads) - known(left.downloads));
			else if (order === "name") sorted.sort((left, right) => left.name.localeCompare(right.name));
			return sorted;
		}
		/**
		 * The tab body.
		 * @param props - owner props from the Plugins page plus this plugin's face (`t`, `market`).
		 */
		function StatsSection(props) {
			const t = props.t;
			// Depend on the stable functions, never on the props object: the slot
			// host merges owner props into a fresh object on every render.
			const market = props.market;
			const subscribe = props.subscribe;
			const [state, setState] = React.useState({ status: "loading", rows: [], updated: null, error: null, noMarket: false });
			const [order, setOrder] = React.useState("stars");
			const [query, setQuery] = React.useState("");
			const [shown, setShown] = React.useState(RENDER_STEP);
			const generation = React.useRef(0);
			const load = React.useCallback(async () => {
				const run = ++generation.current;
				setState((previous) => ({ ...previous, status: previous.rows.length === 0 ? "loading" : "refreshing", error: null }));
				const service = market();
				if (service === undefined) {
					setState({ status: "ready", rows: [], updated: null, error: null, noMarket: true });
					return;
				}
				try {
					const answer = await collect(service);
					if (run !== generation.current) return;
					// The same package can be listed by several sources; keep the best row.
					const merged = new Map();
					for (const row of answer.rows) {
						const previous = merged.get(row.name);
						if (previous === undefined) merged.set(row.name, row);
						else
							merged.set(row.name, {
								...previous,
								stars: previous.stars ?? row.stars,
								downloads: previous.downloads ?? row.downloads,
								window: previous.window ?? row.window,
								installed: previous.installed ?? row.installed,
							});
					}
					setState({ status: "ready", rows: [...merged.values()], updated: answer.updated, error: null, noMarket: false });
				} catch (error) {
					if (run !== generation.current) return;
					setState((previous) => ({ ...previous, status: "error", error: error instanceof Error ? error.message : String(error) }));
				}
			}, [market]);
			React.useEffect(() => {
				void load();
			}, [load]);
			React.useEffect(() => subscribe(() => void load()), [subscribe, load]);
			const visible = React.useMemo(() => {
				const needle = query.trim().toLowerCase();
				const rows =
					needle === ""
						? state.rows
						: state.rows.filter((row) => row.name.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle));
				return sortRows(rows, order);
			}, [state.rows, order, query]);
			const page = visible.slice(0, shown);
			const toolbar = React.createElement(
				"div",
				{ className: "mstats-toolbar" },
				React.createElement("input", {
					type: "search",
					className: "mstats-input",
					value: query,
					placeholder: t("searchPlaceholder"),
					"aria-label": t("search"),
					onChange: (event) => {
						setQuery(event.target.value);
						setShown(RENDER_STEP);
					},
				}),
				React.createElement(
					"label",
					{ className: "mstats-sort" },
					React.createElement("span", null, t("sort")),
					React.createElement(
						"select",
						{ value: order, onChange: (event) => setOrder(event.target.value) },
						React.createElement("option", { value: "stars" }, t("sortStars")),
						React.createElement("option", { value: "downloads" }, t("sortDownloads")),
						React.createElement("option", { value: "name" }, t("sortName")),
						React.createElement("option", { value: "default" }, t("sortDefault")),
					),
				),
				React.createElement(
					"button",
					{ type: "button", className: "mstats-button", "aria-busy": state.status === "refreshing", onClick: () => void load() },
					t("refresh"),
				),
			);
			let body;
			if (state.status === "loading") body = React.createElement("p", { className: "mstats-muted" }, t("loading"));
			else if (state.status === "error")
				body = React.createElement(
					"div",
					{ className: "mstats-failure", role: "alert" },
					React.createElement("p", { className: "mstats-failure-title" }, t("failed")),
					React.createElement("code", { className: "mstats-error" }, state.error ?? ""),
					React.createElement("button", { type: "button", className: "mstats-button", onClick: () => void load() }, t("retry")),
				);
			else if (state.noMarket)
				body = React.createElement(
					"div",
					{ className: "mstats-empty" },
					React.createElement("p", { className: "mstats-empty-title" }, t("noMarket")),
					React.createElement("p", { className: "mstats-muted" }, t("noMarketHint")),
				);
			else if (state.rows.length === 0)
				body = React.createElement(
					"div",
					{ className: "mstats-empty" },
					React.createElement("p", { className: "mstats-empty-title" }, t("noIndex")),
					React.createElement("p", { className: "mstats-muted" }, t("noIndexHint")),
				);
			else if (visible.length === 0)
				body = React.createElement(
					"div",
					{ className: "mstats-empty" },
					React.createElement("p", { className: "mstats-empty-title" }, t("emptyFilter")),
				);
			else
				body = React.createElement(
					"div",
					{ className: "mstats-list" },
					React.createElement(
						"p",
						{ className: "mstats-muted" },
						query.trim() === "" ? t("count", { count: visible.length }) : t("filtered", { count: visible.length }),
						state.updated === null ? null : ` · ${t("feedNote", { date: state.updated })}`,
					),
					React.createElement(
						"table",
						{ className: "mstats-table" },
						React.createElement(
							"thead",
							null,
							React.createElement(
								"tr",
								null,
								React.createElement("th", { scope: "col" }, t("sortName")),
								React.createElement("th", { scope: "col", className: "mstats-num" }, t("stars")),
								React.createElement("th", { scope: "col", className: "mstats-num" }, t("downloads")),
							),
						),
						React.createElement(
							"tbody",
							null,
							...page.map((row) =>
								React.createElement(
									"tr",
									{ key: row.name },
									React.createElement(
										"td",
										null,
										row.repo === null
											? React.createElement("span", null, row.name)
											: React.createElement(
													"a",
													{
														href: `https://github.com/${row.repo}`,
														target: "_blank",
														rel: "noreferrer noopener",
														title: t("openRepo"),
													},
													row.name,
												),
										row.installed === null || row.installed === "not-installed"
											? null
											: React.createElement("span", { className: "mstats-badge" }, row.installed),
									),
									React.createElement(
										"td",
										{ className: "mstats-num", title: row.stars === null ? t("none") : String(row.stars) },
										compact(row.stars) ?? t("none"),
									),
									React.createElement(
										"td",
										{
											className: "mstats-num",
											title:
												row.downloads === null
													? t("none")
													: `${row.window === "7d" ? t("window7d") : t("window30d")}: ${row.downloads}`,
										},
										compact(row.downloads) ?? t("none"),
									),
								),
							),
						),
					),
					visible.length > page.length
						? React.createElement(
								"button",
								{ type: "button", className: "mstats-button mstats-more", onClick: () => setShown((value) => value + RENDER_STEP) },
								t("loadMore"),
							)
						: null,
				);
			return React.createElement("div", { className: "mstats-root" }, toolbar, body);
		}
		/** The tab's stylesheet; every colour is a host token, so light and dark both work. */
		const CSS = [
			".mstats-root{display:flex;flex-direction:column;gap:12px;padding:4px 0 24px}",
			".mstats-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}",
			".mstats-input{flex:1 1 200px;min-width:160px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit}",
			".mstats-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".mstats-sort{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".mstats-sort select{padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}",
			".mstats-button{padding:6px 12px;border-radius:8px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}",
			".mstats-button:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".mstats-button[aria-busy=true]{opacity:.6;cursor:progress}",
			".mstats-more{align-self:center}",
			".mstats-muted{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".mstats-table{width:100%;border-collapse:collapse;font-size:13px}",
			".mstats-table th{text-align:left;font-weight:500;font-size:11px;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l2);padding:6px 8px}",
			".mstats-table td{padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}",
			".mstats-table tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}",
			".mstats-table a{color:var(--dsw-alias-link);text-decoration:none}",
			".mstats-table a:hover{text-decoration:underline}",
			".mstats-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".mstats-badge{margin-left:8px;padding:1px 6px;border-radius:999px;font-size:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3)}",
			".mstats-failure{display:flex;flex-direction:column;gap:8px;align-items:flex-start}",
			".mstats-failure-title{margin:0;font-size:13px;color:var(--dsw-alias-label-primary)}",
			".mstats-error{font-size:11px;color:var(--dsw-alias-label-error);white-space:pre-wrap}",
			".mstats-empty{display:flex;flex-direction:column;gap:6px;padding:24px 0;align-items:center;text-align:center}",
			".mstats-empty-title{margin:0;font-size:14px;color:var(--dsw-alias-label-primary)}",
		].join("");
		/** Attach the stylesheet once, returning its disposer. */
		function mountStyles() {
			if (typeof document === "undefined") return () => {};
			const style = document.createElement("style");
			style.dataset.marketStats = "";
			style.textContent = CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		/**
		 * Contribute the Stats tab to the Plugins page.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "market-stats: dictionaries");
			ctx.effect(() => mountStyles(), "market-stats: stylesheet");
			const t = ctx.locale.bind(NS);
			/** Reload triggers, fired when the market service appears or disappears. */
			const listeners = new Set();
			const market = () => ctx.get(MARKET);
			ctx.inject([MARKET], () => {
				for (const listener of [...listeners]) listener();
			});
			const subscribe = (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			};
			/**
			 * The face handed to the tab.
			 *
			 * It must be the SAME object on every render: the component keys its
			 * `useCallback`/`useEffect` on it, so a fresh object per render would
			 * reload the whole catalog in a loop. `market` is a getter-like
			 * function, so the service is still resolved at call time and a later
			 * `ctx.inject` notification is what triggers the reload.
			 */
			const face = { t, market, subscribe };
			ctx.slots.inject("plugins.tab", () =>
				ctx.slots.register(
					{
						name: "plugins.tab",
						id: NS,
						order: 20,
						label: () => t("title"),
						locale: NS,
						inject: () => face,
					},
					StatsSection,
				),
			);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.NS = NS;
		exports.collect = collect;
		exports.compact = compact;
		exports.repoKey = repoKey;
		exports.indexFeed = indexFeed;
		exports.sortRows = sortRows;
		return module.exports;
	},
});
