// End-to-end check: fake Stream Deck (WebSocket) + mock Univelop API + the real property inspectors in Chromium.
// Run after `npm run build`: npm run e2e   (needs Playwright with Chromium installed globally)
// Mini Stream Deck + mock Univelop API to exercise the built plugin and its property inspectors.
import { createRequire } from "node:module";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";

const PROJECT = path.resolve(import.meta.dirname, "../..");
const SD = path.join(PROJECT, "de.univelop.streamdeck.sdPlugin");
const req = createRequire(path.join(PROJECT, "package.json"));
const { WebSocketServer } = req("ws");
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? path.join(PROJECT, "dist/e2e");
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

const log = [];
const apiCalls = [];

// ---------------- mock API
const schema = {
	lists: [
		{ id: "LIST_TIME_000000000001", techName: "time_entries", label: "Time tracking", type: "List", bricks: [
			{ id: "b1", techNames: { main: "date" }, label: "Date", type: "Date picker" },
			{ id: "b2", techNames: { main: "start_time" }, label: "Start", type: "Time picker" },
			{ id: "b3", techNames: { main: "end_time" }, label: "End", type: "Time picker" },
			{ id: "b4", techNames: { main: "project" }, label: "Project", type: "Record picker", reference: "LIST_PROJ_000000000002" },
			{ id: "b5", techNames: { main: "description" }, label: "Description", type: "Text field" },
			{ id: "b6", techNames: { main: "status" }, label: "Status", type: "Status", options: [{ techName: "draft", label: "Draft" }, { techName: "submitted", label: "Submitted" }] },
			{ id: "b7", techNames: { main: "hours" }, label: "Hours", type: "Expression", expression: "end-start" },
		] },
		{ id: "LIST_PROJ_000000000002", techName: "projects", label: "Projects", type: "List", bricks: [{ id: "p1", techNames: { main: "name" }, label: "Name", type: "Text field" }] },
		{ id: "LIST_MEMB_000000000003", techName: "members", label: "Members", type: "Members", bricks: [] },
	],
};
const api = http.createServer((rq, rs) => {
	let body = "";
	rq.on("data", (c) => (body += c));
	rq.on("end", () => {
		const u = new URL(rq.url, "http://x");
		apiCalls.push({ method: rq.method, path: u.pathname + u.search, key: rq.headers["x-api-key"], body: body ? JSON.parse(body) : undefined });
		const send = (code, data) => { rs.writeHead(code, { "content-type": "application/json" }); rs.end(JSON.stringify(data)); };
		if (rq.headers["x-api-key"] !== "test-key") return send(403, { error: "Invalid API key" });
		const p = u.pathname.replace("/api/v2/workspaces/WS123", "");
		if (p === "") return send(200, { id: "WS123", labelMl: { de: "Demo Workspace" } });
		if (p === "/schema") return send(200, schema);
		if (p === "/records/projects" && rq.method === "GET") return send(200, [{ id: "proj1", title: "Website relaunch" }, { id: "proj2", title: "Internal" }]);
		if (p === "/records/time_entries" && rq.method === "POST") return send(201, { id: "rec42", ...JSON.parse(body) });
		if (p.startsWith("/records/time_entries/") && rq.method === "PATCH") return send(200, { id: "rec42" });
		if (p === "/workflows/send_report/run") return send(202, { message: "Flow triggered" });
		if (p === "/workflows/count_open/run-and-wait") return send(200, { executionId: "e1", returnValue: { count: 17 } });
		if (p === "/workflows/send_report/lastExecution") return send(200, { id: "f1", createdAt: "2026-11-26T10:00:00Z" });
		send(404, { error: "Not found" });
	});
});
await new Promise((r) => api.listen(0, r));
const API = `http://127.0.0.1:${api.address().port}`;

// ---------------- mini Stream Deck
let globals = {};
const settings = {};
let plugin, pi, piCtx;
const wss = new WebSocketServer({ port: 0 });
await new Promise((r) => wss.on("listening", r));
const PORT = wss.address().port;
let pluginReady;
const pluginReadyP = new Promise((r) => (pluginReady = r));
const waiters = [];
const waitFor = (pred, ms = 8000) => new Promise((res, rej) => {
	const t = setTimeout(() => { console.error("TIMEOUT", pred.toString(), JSON.stringify(log.slice(-12), null, 1).slice(0, 4000), JSON.stringify(apiCalls.slice(-5)), pluginOut.slice(-1500)); page.screenshot({ path: OUT + "/fail.png", fullPage: true }).finally(() => process.exit(1)); }, ms);
	waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
});

wss.on("connection", (ws) => {
	ws.on("message", (raw) => {
		const m = JSON.parse(raw);
		if (m.event === "registerPlugin") { plugin = ws; pluginReady(); return; }
		if (m.event === "registerPropertyInspector") { pi = ws; return; }
		const fromPI = ws === pi;
		log.push({ from: fromPI ? "pi" : "plugin", event: m.event, context: m.context, payload: m.payload });
		for (const w of [...waiters]) if (w.pred(m, fromPI)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
		switch (m.event) {
			case "getGlobalSettings":
				ws.send(JSON.stringify({ event: "didReceiveGlobalSettings", id: m.id, payload: { settings: globals } }));
				break;
			case "setGlobalSettings":
				globals = m.payload;
				(fromPI ? plugin : pi)?.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: globals } }));
				break;
			case "setSettings": {
				const ctx = fromPI ? piCtx.context : m.context;
				settings[ctx] = m.payload;
				const target = fromPI ? plugin : pi;
				target?.send(JSON.stringify({ event: "didReceiveSettings", action: piCtx?.action, context: ctx, device: "dev1", payload: { settings: m.payload, coordinates: { column: 0, row: 0 }, isInMultiAction: false } }));
				break;
			}
			case "sendToPlugin":
				plugin.send(JSON.stringify({ event: "sendToPlugin", action: piCtx.action, context: piCtx.context, payload: m.payload }));
				break;
			case "sendToPropertyInspector":
				pi?.send(JSON.stringify({ event: "sendToPropertyInspector", action: piCtx?.action, context: m.context, payload: m.payload }));
				break;
		}
	});
});

const info = { application: { font: "x", language: "en", platform: "mac", platformVersion: "14", version: "7.1.0.0" }, plugin: { uuid: "de.univelop.streamdeck", version: "0.1.0.0" }, devicePixelRatio: 2, colors: {}, devices: [{ id: "dev1", name: "SD", size: { columns: 5, rows: 3 }, type: 0 }] };
const proc = spawn("node", ["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "de.univelop.streamdeck", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], { cwd: SD, stdio: ["ignore", "pipe", "pipe"] });
let pluginOut = "";
proc.stdout.on("data", (d) => (pluginOut += d));
proc.stderr.on("data", (d) => (pluginOut += d));
await pluginReadyP;

const ACT = (a) => `de.univelop.streamdeck.${a}`;
function sdEvent(event, action, context, s, extra = {}) {
	plugin.send(JSON.stringify({ event, action: ACT(action), context, device: "dev1", payload: { settings: s, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, ...extra } }));
}

// ---------------- PI via Playwright
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 900 }, deviceScaleFactor: 2 });
page.on("console", (m) => m.type() === "error" && log.push({ console: m.text() }));
page.on("pageerror", (e) => log.push({ pageerror: e.message }));

async function openPI(action, context, file) {
	piCtx = { action: ACT(action), context };
	settings[context] ??= {};
	sdEvent("willAppear", action, context, settings[context]);
	await page.goto(`file://${SD}/ui/${file}`);
	await page.evaluate(([port, a, c, s]) => window.connectElgatoStreamDeckSocket(port, "pi-uuid", "registerPropertyInspector", "{}", JSON.stringify({ action: a, context: c, payload: { settings: s } })), [PORT, ACT(action), context, settings[context]]);
	plugin.send(JSON.stringify({ event: "propertyInspectorDidAppear", action: ACT(action), context, device: "dev1" }));
	await page.waitForTimeout(400);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Create-record PI: configure connection from scratch
await openPI("create-record", "ctxRec", "create-record.html");
await page.screenshot({ path: `${OUT}/1-connection-empty.png`, fullPage: true });
await page.fill('input[type=password]', "test-key");
await page.fill('input[placeholder^="e.g."]', "https://app.univelop.de/#/ws/WS123/records-list/abc");
await page.selectOption("details.section select", "custom");
await page.fill('input[placeholder="https://app.univelop.de"] >> nth=0', API);
await page.fill('input[placeholder="https://app.univelop.de"] >> nth=1', "https://app.univelop.de");
await sleep(700);
await page.click("text=Test connection");
await page.waitForSelector(".status.ok", { state: "attached" });
const connStatus = await page.textContent(".status.ok");
await sleep(500);
// pick list
await page.selectOption("#main select >> nth=0", "LIST_TIME_000000000001");
await page.waitForSelector("button:has-text(\"Time tracking\")");
await page.click("button:has-text(\"Time tracking\")");
await sleep(300);
// add project + description
await page.selectOption(".fields + .row select >> nth=0", "project");
await sleep(800);
await page.selectOption(".field:has-text('Project') select", "proj1");
await page.selectOption(".fields + .row select >> nth=0", "description");
await page.fill(".field:has-text('Description') input[type=text]", "Deep work");
await sleep(800);
await page.click("text=Preview request");
await sleep(500);
await page.screenshot({ path: `${OUT}/2-create-record-timer.png`, fullPage: true });
const preview = await page.textContent("pre.preview");

// 2) press key twice (timer)
const recSettings = settings.ctxRec;
sdEvent("keyDown", "create-record", "ctxRec", recSettings);
await waitFor((m) => m.event === "setSettings" && m.payload?.running);
await sleep(1200);
sdEvent("keyDown", "create-record", "ctxRec", settings.ctxRec);
await waitFor((m) => m.event === "showOk" && m.context === "ctxRec");

// 3) workflow PI + presses
await openPI("run-workflow", "ctxWf", "run-workflow.html");
await page.fill('input[list="recent-workflows"]', "send_report");
await page.fill("textarea", '{ "source": "streamdeck", "at": "{{now}}" }');
await sleep(500);
await page.click("text=Check");
await page.waitForSelector(".status.ok");
await page.screenshot({ path: `${OUT}/3-run-workflow.png`, fullPage: true });
sdEvent("keyDown", "run-workflow", "ctxWf", settings.ctxWf);
await waitFor((m) => m.event === "showOk" && m.context === "ctxWf");
sdEvent("willAppear", "run-workflow", "ctxWf2", { workflow: "count_open", resultPath: "count" });
await sleep(100);
sdEvent("keyDown", "run-workflow", "ctxWf2", { workflow: "count_open", resultPath: "count" });
await waitFor((m) => m.event === "showOk" && m.context === "ctxWf2");

// 4) open tile PI + press
await openPI("open-tile", "ctxOpen", "open-tile.html");
await page.selectOption("#main select >> nth=1", "LIST_PROJ_000000000002");
await sleep(800);
await page.screenshot({ path: `${OUT}/4-open-tile.png`, fullPage: true });
sdEvent("keyDown", "open-tile", "ctxOpen", settings.ctxOpen);
await waitFor((m) => m.event === "openUrl");

// 5) bad key -> alert
globals.apiKey = "wrong";
plugin.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: globals } }));
await sleep(200);
sdEvent("willAppear", "run-workflow", "ctxWf3", { workflow: "send_report" });
await sleep(100);
sdEvent("keyDown", "run-workflow", "ctxWf3", { workflow: "send_report" });
await waitFor((m) => m.event === "showAlert");

await browser.close();
proc.kill();
api.close();
wss.close();

const interesting = log.filter((l) => ["setTitle", "setState", "showOk", "showAlert", "openUrl"].includes(l.event) || l.console || l.pageerror);
console.log(JSON.stringify({ connStatus, preview, apiCalls: apiCalls.map(({ key, ...c }) => ({ ...c, key: key ? "<set>" : undefined })), events: interesting.filter((e) => !(e.event === "setTitle" && /^\d+:\d\d$/.test(e.payload?.title ?? ""))).slice(0, 60) }, null, 2));
console.error(pluginOut.slice(-2000));
process.exit(0);
