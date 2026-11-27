// Renders the SVG icons in assets/icons into the PNG sizes Stream Deck expects.
// Usage: node scripts/render-icons.mjs   (needs Playwright + Chromium)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = (n) => readFileSync(path.join(root, "assets/icons", `${n}.svg`), "utf8");
const out = (p) => path.join(root, "de.univelop.streamdeck.sdPlugin/imgs", p);

// [svg source, output path (without extension), base size]
const jobs = [
	["plugin", "plugin/marketplace", 256],
	["category", "plugin/category-icon", 28],
	["glyph-open", "actions/open-tile/icon", 20],
	["glyph-workflow", "actions/run-workflow/icon", 20],
	["glyph-record", "actions/create-record/icon", 20],
	["key-open", "actions/open-tile/key", 72],
	["key-workflow", "actions/run-workflow/key", 72],
	["key-record", "actions/create-record/key", 72],
	["key-running", "actions/create-record/key-running", 72],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, target, size] of jobs) {
	for (const scale of [1, 2]) {
		const px = size * scale;
		await page.setViewportSize({ width: px, height: px });
		await page.setContent(
			`<html><body style="margin:0;background:transparent">${src(name).replace("<svg", `<svg width="${px}" height="${px}"`)}</body></html>`,
		);
		const file = out(`${target}${scale === 2 ? "@2x" : ""}.png`);
		mkdirSync(path.dirname(file), { recursive: true });
		await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
	}
}
await browser.close();
console.log(`rendered ${jobs.length * 2} images`);
