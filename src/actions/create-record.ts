import streamDeck, {
	action,
	type KeyAction,
	type KeyDownEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
	type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { appBaseUrl, errorMessage, getClient, getGlobals, handleCommonPiRequest } from "../lib/connection.js";
import { buildPayload, type ConfiguredField } from "../lib/fields.js";
import { buildAppUrl } from "../lib/links.js";
import { UnivelopApiError, type UnivelopClient, type UnivelopRecord } from "../lib/univelop-api.js";

export type CreateRecordSettings = {
	listId?: string;
	listTechName?: string;
	listLabel?: string;
	fields?: ConfiguredField[];
	extraJson?: string;
	/** "create": every press creates a record. "timer": press 1 creates, press 2 updates the same record (stop values). */
	mode?: "create" | "timer";
	stopFields?: ConfiguredField[];
	stopExtraJson?: string;
	afterCreate?: "none" | "open-list" | "open-record";
	/** Runtime state of the timer mode, persisted so a running timer survives restarts. */
	running?: { recordId: string; startedAt: number; spec: string } | null;
};

const tickers = new Map<string, NodeJS.Timeout>();
const busy = new Set<string>();

function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Calls fn with the list techName, falling back to the list id when the techName route 404s. */
async function withSpec<T>(s: CreateRecordSettings, fn: (spec: string) => Promise<T>): Promise<{ result: T; spec: string }> {
	const candidates = [s.listTechName, s.listId].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
	if (!candidates.length) throw new Error("No list configured.");
	let lastErr: unknown;
	for (const spec of candidates) {
		try {
			return { result: await fn(spec), spec };
		} catch (err) {
			lastErr = err;
			if (!(err instanceof UnivelopApiError && err.status === 404)) throw err;
		}
	}
	throw lastErr;
}

/**
 * Creates a record with preconfigured default values. In timer mode the first press
 * creates the record (e.g. time entry with start = now) and the second press patches
 * it with the stop values (e.g. end = now).
 */
@action({ UUID: "de.univelop.streamdeck.create-record" })
export class CreateRecordAction extends SingletonAction<CreateRecordSettings> {
	override async onWillAppear(ev: WillAppearEvent<CreateRecordSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<CreateRecordSettings>): void {
		this.#stopTicker(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CreateRecordSettings>): Promise<void> {
		if (ev.action.isKey()) this.#render(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<CreateRecordSettings>): Promise<void> {
		const act = ev.action as KeyAction<CreateRecordSettings>;
		if (busy.has(act.id)) return;
		busy.add(act.id);
		const s = ev.payload.settings;

		try {
			const client = await getClient();
			if (s.mode === "timer" && s.running?.recordId) {
				await this.#stop(act, s, client);
			} else {
				await this.#create(act, s, client);
			}
		} catch (err) {
			streamDeck.logger.error(`create-record (${s.listTechName ?? s.listId}): ${errorMessage(err)}`);
			await act.showAlert();
		} finally {
			busy.delete(act.id);
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, CreateRecordSettings>): Promise<void> {
		const p = (ev.payload ?? {}) as { event?: string; requestId?: string; settings?: CreateRecordSettings };
		if (p.event === "univelop.previewPayload") {
			const reply = (data: Record<string, unknown>) => streamDeck.ui.sendToPropertyInspector({ event: p.event, requestId: p.requestId ?? null, ...data } as never);
			try {
				const s = p.settings ?? {};
				await reply({
					ok: true,
					create: buildPayload(s.fields, s.extraJson),
					stop: s.mode === "timer" ? buildPayload(s.stopFields, s.stopExtraJson) : null,
				});
			} catch (err) {
				await reply({ ok: false, error: errorMessage(err) });
			}
			return;
		}
		if (p.event === "univelop.resetTimer") {
			const settings = await ev.action.getSettings();
			await ev.action.setSettings({ ...settings, running: null });
			if (ev.action.isKey()) this.#render(ev.action, { ...settings, running: null });
			return;
		}
		await handleCommonPiRequest(ev.payload);
	}

	async #create(act: KeyAction<CreateRecordSettings>, s: CreateRecordSettings, client: UnivelopClient): Promise<void> {
		const payload = buildPayload(s.fields, s.extraJson);
		const { result: record, spec } = await withSpec(s, (spec) => client.createRecord(spec, payload));
		streamDeck.logger.info(`created record ${record?.id} in ${spec}`);

		if (s.mode === "timer" && record?.id) {
			const next: CreateRecordSettings = { ...s, running: { recordId: record.id, startedAt: Date.now(), spec } };
			await act.setSettings(next);
			this.#render(act, next);
		} else {
			await act.showOk();
		}
		await this.#afterCreate(s, record);
	}

	async #stop(act: KeyAction<CreateRecordSettings>, s: CreateRecordSettings, client: UnivelopClient): Promise<void> {
		const running = s.running!;
		const payload = buildPayload(s.stopFields, s.stopExtraJson);
		try {
			if (Object.keys(payload).length) await client.updateRecord(running.spec, running.recordId, payload);
		} catch (err) {
			// The record is gone: forget it so the key does not get stuck in "running".
			if (!(err instanceof UnivelopApiError && err.status === 404)) throw err;
			streamDeck.logger.warn(`timer record ${running.recordId} not found – resetting`);
		}
		const next: CreateRecordSettings = { ...s, running: null };
		await act.setSettings(next);
		this.#render(act, next);
		await act.showOk();
	}

	async #afterCreate(s: CreateRecordSettings, record: UnivelopRecord | undefined): Promise<void> {
		if (!s.afterCreate || s.afterCreate === "none" || !s.listId) return;
		const g = await getGlobals();
		if (!g.workspaceId) return;
		// A new record is shown pre-selected inside its list, so the user sees it in context.
		const url = buildAppUrl(await appBaseUrl(), g.workspaceId, {
			view: "list",
			listId: s.listId,
			recordId: s.afterCreate === "open-record" ? record?.id : undefined,
		});
		await streamDeck.system.openUrl(url);
	}

	#render(act: KeyAction<CreateRecordSettings>, s: CreateRecordSettings): void {
		const running = s.mode === "timer" ? s.running : null;
		this.#stopTicker(act.id);
		if (!running) {
			void act.setState(0);
			void act.setTitle(undefined);
			return;
		}
		void act.setState(1);
		const tick = () => void act.setTitle(formatElapsed(Date.now() - running.startedAt));
		tick();
		tickers.set(act.id, setInterval(tick, 1000));
	}

	#stopTicker(id: string): void {
		const t = tickers.get(id);
		if (t) clearInterval(t);
		tickers.delete(id);
	}
}
