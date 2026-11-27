/* Univelop Stream Deck – shared property inspector runtime.
 * No external dependencies: talks to Stream Deck over its WebSocket protocol,
 * renders the shared "Connection" panel and provides helpers for the action UIs.
 */
(function () {
	"use strict";

	const ENVIRONMENTS = {
		app: { label: "Production (app.univelop.de)", api: "https://app.univelop.de", app: "https://app.univelop.de" },
		beta: { label: "Beta app (beta.univelop.de)", api: "https://app.univelop.de", app: "https://beta.univelop.de" },
		dev: { label: "Development (dev.univelop.de)", api: "https://dev.univelop.de", app: "https://dev.univelop.de" },
		custom: { label: "Custom domain…", api: "", app: "" },
	};

	const listeners = { settings: [], globals: [], ready: [], message: [] };
	const pending = new Map();
	let socket = null;
	let uuid = null;
	let actionInfo = null;
	let reqCounter = 0;

	const PI = {
		settings: {},
		globals: {},
		action: null,
		on(evt, fn) {
			listeners[evt].push(fn);
		},
		send(event, payload) {
			if (!socket || socket.readyState !== 1) return;
			socket.send(JSON.stringify({ event, context: uuid, action: actionInfo && actionInfo.action, payload }));
		},
		saveSettings(patch) {
			if (patch) Object.assign(PI.settings, patch);
			PI.send("setSettings", PI.settings);
		},
		saveGlobals(patch) {
			if (patch) Object.assign(PI.globals, patch);
			PI.send("setGlobalSettings", PI.globals);
		},
		openUrl(url) {
			if (socket) socket.send(JSON.stringify({ event: "openUrl", payload: { url } }));
		},
		/** Request/response over sendToPlugin. Resolves with the plugin's reply. */
		request(event, data, timeoutMs) {
			const requestId = `r${++reqCounter}`;
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					pending.delete(requestId);
					resolve({ ok: false, error: "No answer from plugin." });
				}, timeoutMs || 30000);
				pending.set(requestId, (msg) => {
					clearTimeout(timer);
					resolve(msg);
				});
				PI.send("sendToPlugin", Object.assign({ event, requestId }, data || {}));
			});
		},
		isConfigured() {
			return !!(PI.globals.apiKey && PI.globals.workspaceId);
		},
	};
	window.PI = PI;

	/* ---------------------------------------------------------------- DOM helpers */

	function h(tag, attrs, ...children) {
		const el = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs || {})) {
			if (v === undefined || v === null || v === false) continue;
			if (k === "class") el.className = v;
			else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
			else if (k === "value") el.value = v;
			else if (k === "checked" || k === "selected" || k === "disabled" || k === "multiple") el[k] = !!v;
			else el.setAttribute(k, v === true ? "" : v);
		}
		for (const c of children.flat()) {
			if (c === null || c === undefined || c === false) continue;
			el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
		}
		return el;
	}
	PI.h = h;

	PI.row = function (label, control, opts) {
		return h("div", { class: "row" + (opts && opts.stack ? " stack" : "") }, h("label", { title: label }, label), h("div", { class: "control" }, control));
	};

	PI.status = function (el, kind, text) {
		el.className = "status " + (kind || "");
		el.replaceChildren(h("span", { class: "dot" }), h("span", {}, text || ""));
	};

	PI.debounce = function (fn, ms) {
		let t;
		return function (...args) {
			clearTimeout(t);
			t = setTimeout(() => fn.apply(this, args), ms || 300);
		};
	};

	/* ---------------------------------------------------------------- Connection panel */

	function envFromGlobals(g) {
		for (const [key, env] of Object.entries(ENVIRONMENTS)) {
			if (key === "custom") continue;
			if ((g.apiBaseUrl || ENVIRONMENTS.app.api) === env.api && (g.appBaseUrl || ENVIRONMENTS.app.app) === env.app) return key;
		}
		return "custom";
	}

	function renderConnection(root) {
		const g = PI.globals;
		const status = h("span", { class: "status" });
		const keyInput = h("input", { type: "password", placeholder: "uni-…", value: g.apiKey || "", autocomplete: "off", spellcheck: "false" });
		const wsInput = h("input", { type: "text", placeholder: "e.g. eT8cIxNkx5dL8A5jqHf9", value: g.workspaceId || "", spellcheck: "false" });
		const envSelect = h(
			"select",
			{},
			Object.entries(ENVIRONMENTS).map(([k, e]) => h("option", { value: k }, e.label)),
		);
		envSelect.value = envFromGlobals(g);
		const apiInput = h("input", { type: "text", placeholder: "https://app.univelop.de", value: g.apiBaseUrl || "" });
		const appInput = h("input", { type: "text", placeholder: "https://app.univelop.de", value: g.appBaseUrl || "" });
		const customRows = h("div", {}, PI.row("API URL", apiInput), PI.row("App URL", appInput));
		const toggleKey = h("button", { class: "icon", title: "Show / hide", type: "button" }, "👁");
		const testBtn = h("button", { class: "primary", type: "button" }, "Test connection");

		toggleKey.onclick = () => (keyInput.type = keyInput.type === "password" ? "text" : "password");

		const syncCustom = () => customRows.classList.toggle("hidden", envSelect.value !== "custom");
		syncCustom();

		const save = () => {
			const env = ENVIRONMENTS[envSelect.value];
			const patch = {
				apiKey: keyInput.value.trim(),
				workspaceId: extractWorkspaceId(wsInput.value.trim()),
				apiBaseUrl: envSelect.value === "custom" ? apiInput.value.trim().replace(/\/+$/, "") : env.api,
				appBaseUrl: envSelect.value === "custom" ? appInput.value.trim().replace(/\/+$/, "") : env.app,
			};
			if (patch.workspaceId !== wsInput.value.trim()) wsInput.value = patch.workspaceId;
			PI.saveGlobals(patch);
			summaryState.className = "dot " + (PI.isConfigured() ? "" : "warn");
		};
		const saveDebounced = PI.debounce(save, 500);
		keyInput.oninput = saveDebounced;
		wsInput.oninput = saveDebounced;
		apiInput.oninput = saveDebounced;
		appInput.oninput = saveDebounced;
		envSelect.onchange = () => {
			syncCustom();
			save();
			listeners.globals.forEach((fn) => fn(PI.globals, true));
		};

		testBtn.onclick = async () => {
			save();
			testBtn.disabled = true;
			PI.status(status, "", "Testing…");
			const res = await PI.request("univelop.testConnection", { settings: PI.globals });
			testBtn.disabled = false;
			if (!res.ok) return PI.status(status, "err", res.error);
			if (res.schemaError) return PI.status(status, "warn", `Connected to “${res.workspace}”, but schema not readable: ${res.schemaError}`);
			PI.status(status, "ok", `Connected to “${res.workspace}” · ${res.lists} lists`);
			details.removeAttribute("open");
			summaryState.className = "dot ok";
			listeners.globals.forEach((fn) => fn(PI.globals, true));
		};

		const summaryState = h("span", { class: "dot " + (PI.isConfigured() ? "ok" : "warn") });
		const details = h(
			"details",
			{ class: "section", open: !PI.isConfigured() },
			h("summary", {}, summaryState, "Univelop connection"),
			PI.row("API key", [keyInput, toggleKey]),
			PI.row("Workspace ID", wsInput),
			h("div", { class: "hint" }, "Paste the ID or any workspace URL. API keys: Workspace settings → API."),
			PI.row("Environment", envSelect),
			customRows,
			PI.row("", [testBtn, status]),
			h("div", { class: "hint" }, "Shared by all Univelop keys. Reading the schema requires an admin/owner key."),
		);
		root.replaceChildren(details);
	}

	/** Accepts a raw ID or an app URL like https://app.univelop.de/#/ws/<id>/… */
	function extractWorkspaceId(v) {
		const m = /\/ws\/([A-Za-z0-9_-]+)/.exec(v);
		return m ? m[1] : v;
	}

	/* ---------------------------------------------------------------- Shared widgets */

	let listsCache = null;
	/** Record lookups are cached per PI session – every API call costs Univelop credits. */
	const recordCache = new Map();

	/** Loads the lists of the workspace via schema discovery. */
	PI.loadLists = async function (refresh) {
		if (!PI.isConfigured()) return { ok: false, error: "Configure the connection first." };
		if (listsCache && !refresh) return listsCache;
		const res = await PI.request("univelop.getLists", { refresh: !!refresh });
		if (res.ok) listsCache = res;
		return res;
	};

	/**
	 * A list (tile) picker filled from the workspace schema.
	 * onChange receives the selected list object ({id, techName, label}) or null.
	 */
	PI.listPicker = function (opts) {
		const select = h("select", {}, h("option", { value: "" }, "Loading…"));
		const refresh = h("button", { class: "icon", type: "button", title: "Reload schema" }, "⟳");
		const status = h("div", { class: "hint" });
		let lists = [];

		async function load(force) {
			if (!PI.isConfigured()) {
				select.replaceChildren(h("option", { value: "" }, "— set up connection first —"));
				return;
			}
			refresh.disabled = true;
			const res = await PI.loadLists(force);
			refresh.disabled = false;
			if (!res.ok) {
				status.textContent = res.error;
				status.classList.add("err");
				select.replaceChildren(h("option", { value: "" }, "— could not load lists —"));
				return;
			}
			status.textContent = "";
			lists = res.lists;
			const current = opts.value();
			const groups = {};
			for (const l of lists) (groups[l.type] = groups[l.type] || []).push(l);
			select.replaceChildren(
				h("option", { value: "" }, opts.placeholder || "— choose a list —"),
				...Object.entries(groups).map(([type, items]) =>
					h(
						"optgroup",
						{ label: type },
						items.map((l) => h("option", { value: l.id, title: l.techName }, `${l.label}${l.isShared ? " (shared)" : ""}`)),
					),
				),
			);
			if (current && !lists.some((l) => l.id === current)) {
				select.appendChild(h("option", { value: current }, `${opts.currentLabel?.() || current} (not found)`));
			}
			select.value = current || "";
		}

		select.onchange = () => opts.onChange(lists.find((l) => l.id === select.value) || null);
		refresh.onclick = () => load(true);
		PI.on("globals", (_g, changed) => changed && ((listsCache = null), recordCache.clear(), load(false)));
		load(false);
		return h("div", {}, PI.row(opts.label || "List", [select, refresh]), status);
	};

	/**
	 * A searchable record picker for a referenced list.
	 * opts: { spec, multiple, value: string|string[], labels: string[], onChange(ids, labels) }
	 */
	PI.recordPicker = function (opts) {
		const search = h("input", { type: "search", placeholder: "Search records…" });
		const select = h("select", { multiple: !!opts.multiple });
		const ids = () => (Array.isArray(opts.value) ? opts.value : opts.value ? [opts.value] : []);
		const known = new Map(ids().map((id, i) => [id, (opts.labels || [])[i] || id]));

		function fill(records) {
			for (const r of records) known.set(r.id, r.title);
			const selected = ids();
			const all = new Map(selected.map((id) => [id, known.get(id) || id]));
			for (const r of records) all.set(r.id, r.title);
			select.replaceChildren(
				...(opts.multiple ? [] : [h("option", { value: "" }, "— none —")]),
				...[...all.entries()].map(([id, title]) => h("option", { value: id, selected: selected.includes(id) }, title)),
			);
		}

		async function load() {
			if (!opts.spec) return fill([]);
			const cacheKey = `${opts.spec}|${search.value.trim()}`;
			let res = recordCache.get(cacheKey);
			if (!res) {
				res = await PI.request("univelop.getRecords", { spec: opts.spec, query: search.value });
				if (res.ok) recordCache.set(cacheKey, res);
			}
			fill(res.ok ? res.records : []);
		}

		select.onchange = () => {
			const chosen = [...select.selectedOptions].map((o) => o.value).filter(Boolean);
			opts.onChange(
				opts.multiple ? chosen : chosen[0] || "",
				chosen.map((id) => known.get(id) || id),
			);
		};
		search.oninput = PI.debounce(load, 400);
		fill([]);
		load();
		return h("div", { class: "control stack", style: "width:100%" }, search, select);
	};

	/* ---------------------------------------------------------------- Field editor */

	const TOKEN_SUGGESTIONS = {
		date: ["{{today}}", "{{today-1d}}", "{{today+1d}}", "{{today+7d}}"],
		datetime: ["{{now}}", "{{now|round15}}", "{{now|floor15}}", "{{now+1h}}"],
		time: ["{{time}}", "{{time|round15}}", "{{time|floor15}}", "{{time|ceil15}}"],
		text: ["{{datetime}}", "{{date}}", "{{time}}"],
		number: ["{{timestamp}}", "{{weekday}}"],
	};
	const KIND_LABEL = {
		text: "text",
		number: "number",
		bool: "yes/no",
		date: "date",
		datetime: "date & time",
		time: "time",
		option: "choice",
		options: "multi choice",
		record: "record",
		records: "records",
	};

	/**
	 * Editor for a list of ConfiguredField objects.
	 * opts: { fields: FieldDescriptor[] (schema), value: ConfiguredField[], onChange(list), title }
	 */
	PI.fieldEditor = function (opts) {
		const container = h("div", { class: "fields" });
		const addSelect = h("select", {});
		let value = (opts.value || []).slice();

		const descriptorFor = (key) => opts.fields.find((f) => f.key === key);
		const emit = () => opts.onChange(value.slice());

		function renderAdd() {
			const used = new Set(value.map((v) => v.key));
			const avail = opts.fields.filter((f) => !used.has(f.key));
			const simple = avail.filter((f) => !f.advanced);
			const adv = avail.filter((f) => f.advanced);
			addSelect.replaceChildren(
				h("option", { value: "" }, avail.length ? "+ Add field…" : "All fields added"),
				...simple.map((f) => h("option", { value: f.key }, `${f.label} · ${KIND_LABEL[f.kind]}`)),
				adv.length ? h("optgroup", { label: "Other bricks (unverified)" }, adv.map((f) => h("option", { value: f.key }, `${f.label} · ${f.brickType || "?"}`))) : null,
				h("option", { value: "__custom" }, "Custom key…"),
			);
			addSelect.value = "";
		}

		addSelect.onchange = () => {
			const k = addSelect.value;
			if (!k) return;
			if (k === "__custom") {
				value.push({ key: "", kind: "text", value: "", label: "Custom", custom: true });
			} else {
				const d = descriptorFor(k);
				value.push({ key: d.key, kind: d.kind, value: defaultFor(d), label: d.label });
			}
			emit();
			render();
		};

		function defaultFor(d) {
			if (d.kind === "bool") return true;
			if (d.kind === "options" || d.kind === "records") return [];
			if (d.kind === "option" && d.options && d.options[0]) return d.options[0].value;
			return "";
		}

		function input(f, d) {
			const update = (v, labels) => {
				f.value = v;
				if (labels) f.valueLabels = labels;
				emit();
			};
			switch (f.kind) {
				case "bool": {
					const s = h("select", {}, h("option", { value: "true" }, "Yes"), h("option", { value: "false" }, "No"));
					s.value = f.value === false || f.value === "false" ? "false" : "true";
					s.onchange = () => update(s.value === "true");
					return s;
				}
				case "option": {
					if (!d || !d.options || !d.options.length) break;
					const s = h(
						"select",
						{},
						d.options.map((o) => h("option", { value: o.value }, o.label)),
					);
					s.value = f.value || "";
					s.onchange = () => update(s.value);
					return s;
				}
				case "options": {
					if (!d || !d.options || !d.options.length) break;
					const sel = new Set(Array.isArray(f.value) ? f.value : []);
					return h(
						"div",
						{ class: "option-list" },
						d.options.map((o) => {
							const cb = h("input", { type: "checkbox", checked: sel.has(o.value) });
							cb.onchange = () => {
								cb.checked ? sel.add(o.value) : sel.delete(o.value);
								update([...sel]);
							};
							return h("label", { class: "checkbox" }, cb, o.label);
						}),
					);
				}
				case "record":
				case "records":
					if (!d || !(d.referenceTechName || d.reference)) break;
					return PI.recordPicker({
						spec: d.referenceTechName || d.reference,
						multiple: f.kind === "records",
						value: f.value,
						labels: f.valueLabels,
						onChange: update,
					});
			}
			// text-like input with placeholder suggestions
			const inp = h("input", {
				type: "text",
				value: Array.isArray(f.value) ? f.value.join(", ") : f.value === undefined || f.value === null ? "" : String(f.value),
				placeholder: placeholderFor(f.kind),
				spellcheck: "false",
			});
			inp.oninput = PI.debounce(() => update(inp.value), 300);
			const sugg = TOKEN_SUGGESTIONS[f.kind] || TOKEN_SUGGESTIONS.text;
			const chips = h(
				"div",
				{ class: "chips" },
				sugg.map((t) =>
					h(
						"span",
						{
							class: "chip",
							title: "Insert",
							onclick: () => {
								inp.value = f.kind === "text" ? (inp.value ? inp.value + " " : "") + t : t;
								update(inp.value);
							},
						},
						t,
					),
				),
			);
			return h("div", { class: "control stack", style: "width:100%" }, inp, chips);
		}

		function placeholderFor(kind) {
			return (
				{
					date: "YYYY-MM-DD or {{today}}",
					datetime: "YYYY-MM-DDTHH:MM or {{now}}",
					time: "HH:MM or {{time}}",
					number: "e.g. 1.5",
					records: "id1, id2",
					record: "record id",
					options: "option1, option2",
					option: "option techName",
				}[kind] || "Value or {{placeholder}}"
			);
		}

		function render() {
			container.replaceChildren();
			if (!value.length) container.appendChild(h("div", { class: "empty" }, opts.emptyText || "No fields yet."));
			value.forEach((f, i) => {
				const d = descriptorFor(f.key);
				const enabled = h("input", { type: "checkbox", checked: f.enabled !== false, title: "Enabled" });
				enabled.onchange = () => {
					f.enabled = enabled.checked;
					emit();
				};
				const remove = h("button", { class: "icon", type: "button", title: "Remove" }, "✕");
				remove.onclick = () => {
					value.splice(i, 1);
					emit();
					render();
				};
				const keyInput = h("input", { type: "text", value: f.key, spellcheck: "false" });
				keyInput.oninput = PI.debounce(() => {
					f.key = keyInput.value.trim();
					emit();
				}, 400);
				const kindSelect = h(
					"select",
					{ style: "width:auto" },
					Object.entries(KIND_LABEL).map(([k, l]) => h("option", { value: k }, l)),
				);
				kindSelect.value = f.kind;
				kindSelect.onchange = () => {
					f.kind = kindSelect.value;
					emit();
					render();
				};

				container.appendChild(
					h(
						"div",
						{ class: "field" },
						h(
							"div",
							{ class: "field-head" },
							enabled,
							h("span", { class: "name", title: (d && d.description) || "" }, (d && d.label) || f.label || f.key || "Custom field"),
							h("span", { class: "badge" }, KIND_LABEL[f.kind] || f.kind),
							remove,
						),
						input(f, d),
						h(
							"details",
							{ open: !d && !f.key },
							h("summary", { class: "hint full", style: "cursor:pointer" }, `API key: ${f.key || "(not set)"}`),
							h("div", { class: "key" }, "key", keyInput, "type", kindSelect),
						),
					),
				);
			});
			renderAdd();
		}

		render();
		return {
			el: h("div", {}, container, h("div", { class: "row" }, h("div", { class: "control" }, addSelect))),
			set(v) {
				value = (v || []).slice();
				render();
			},
			get() {
				return value.slice();
			},
		};
	};

	/* ---------------------------------------------------------------- Stream Deck bootstrap */

	window.connectElgatoStreamDeckSocket = function (port, inUUID, registerEvent, info, inActionInfo) {
		uuid = inUUID;
		actionInfo = JSON.parse(inActionInfo || "{}");
		PI.action = actionInfo.action;
		PI.settings = (actionInfo.payload && actionInfo.payload.settings) || {};

		socket = new WebSocket("ws://127.0.0.1:" + port);
		socket.onopen = () => {
			socket.send(JSON.stringify({ event: registerEvent, uuid }));
			socket.send(JSON.stringify({ event: "getGlobalSettings", context: uuid }));
		};
		let ready = false;
		socket.onmessage = (evt) => {
			const msg = JSON.parse(evt.data);
			switch (msg.event) {
				case "didReceiveGlobalSettings":
					PI.globals = (msg.payload && msg.payload.settings) || {};
					if (!ready) {
						ready = true;
						const conn = document.getElementById("connection");
						if (conn) renderConnection(conn);
						listeners.ready.forEach((fn) => fn());
					}
					listeners.globals.forEach((fn) => fn(PI.globals, false));
					break;
				case "didReceiveSettings":
					PI.settings = (msg.payload && msg.payload.settings) || {};
					listeners.settings.forEach((fn) => fn(PI.settings));
					break;
				case "sendToPropertyInspector": {
					const p = msg.payload || {};
					const cb = p.requestId && pending.get(p.requestId);
					if (cb) {
						pending.delete(p.requestId);
						cb(p);
					} else listeners.message.forEach((fn) => fn(p));
					break;
				}
			}
		};
	};
})();
