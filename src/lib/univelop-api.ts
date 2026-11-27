/**
 * Minimal client for the Univelop REST API v2.
 * Reference: https://app.univelop.de/api/v2/docs
 */

export type Connection = {
	apiKey: string;
	workspaceId: string;
	/** API base, e.g. https://app.univelop.de */
	apiBaseUrl?: string;
};

export type SchemaOption = {
	techName: string;
	label?: string | null;
	color?: string | null;
	icon?: string | null;
};

export type SchemaBrick = {
	id: string;
	techNames: Record<string, string>;
	label?: string;
	type?: string;
	aiDescription?: string | null;
	tooltip?: string | null;
	options?: SchemaOption[];
	reference?: string;
	expression?: string;
};

export type SchemaList = {
	id: string;
	label?: string;
	techName: string;
	type?: string;
	aiDescription?: string | null;
	isShared?: boolean;
	bricks?: SchemaBrick[];
};

export type WorkspaceSchema = { lists: SchemaList[] };

export type Workspace = {
	id: string;
	labelMl?: Record<string, string>;
	created_at?: string;
	modified_at?: string;
};

export type UnivelopRecord = { id: string; title?: string; [key: string]: unknown };

export const DEFAULT_API_BASE_URL = "https://app.univelop.de";

export class UnivelopApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly body?: unknown,
	) {
		super(message);
		this.name = "UnivelopApiError";
	}

	/** Short message suitable for a key title / property inspector. */
	get hint(): string {
		switch (this.status) {
			case 401:
			case 403:
				return "Access denied – check API key, workspace ID and role (schema needs admin/owner).";
			case 404:
				return "Not found – check the technical name / ID.";
			case 422:
				return "Workflow timed out.";
			default:
				return this.message;
		}
	}
}

type RequestOptions = {
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
	timeoutMs?: number;
};

export class UnivelopClient {
	readonly #conn: Required<Connection>;

	constructor(conn: Connection) {
		if (!conn.apiKey?.trim()) throw new UnivelopApiError(0, "No API key configured.");
		if (!conn.workspaceId?.trim()) throw new UnivelopApiError(0, "No workspace ID configured.");
		this.#conn = {
			apiKey: conn.apiKey.trim(),
			workspaceId: conn.workspaceId.trim(),
			apiBaseUrl: (conn.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, ""),
		};
	}

	get workspaceId(): string {
		return this.#conn.workspaceId;
	}

	#ws(path = ""): string {
		return `/api/v2/workspaces/${encodeURIComponent(this.#conn.workspaceId)}${path}`;
	}

	async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
		const url = new URL(this.#conn.apiBaseUrl + path);
		for (const [k, v] of Object.entries(opts.query ?? {})) {
			if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
		let res: Response;
		try {
			res = await fetch(url, {
				method,
				headers: {
					"x-api-key": this.#conn.apiKey,
					Accept: "application/json",
					...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
				},
				body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
				signal: controller.signal,
			});
		} catch (err) {
			const msg = (err as Error).name === "AbortError" ? "Request timed out." : `Network error: ${(err as Error).message}`;
			throw new UnivelopApiError(0, msg);
		} finally {
			clearTimeout(timer);
		}

		const text = await res.text();
		let data: unknown = undefined;
		if (text) {
			try {
				data = JSON.parse(text);
			} catch {
				data = text;
			}
		}

		if (!res.ok) {
			const msg =
				(data && typeof data === "object" && ((data as { error?: string }).error || (data as { message?: string }).message)) ||
				(typeof data === "string" && data) ||
				res.statusText;
			throw new UnivelopApiError(res.status, `HTTP ${res.status}: ${String(msg).slice(0, 300)}`, data);
		}
		return data as T;
	}

	getWorkspace(): Promise<Workspace> {
		return this.request("GET", this.#ws());
	}

	async getSchema(): Promise<WorkspaceSchema> {
		const schema = await this.request<WorkspaceSchema>("GET", this.#ws("/schema"));
		return { lists: Array.isArray(schema?.lists) ? schema.lists : [] };
	}

	listRecords(
		spec: string,
		opts: { limit?: number; orderBy?: string; desc?: boolean; filters?: unknown[] } = {},
	): Promise<UnivelopRecord[]> {
		return this.request("GET", this.#ws(`/records/${encodeURIComponent(spec)}`), {
			query: {
				limit: Math.min(opts.limit ?? 50, 200),
				orderBy: opts.orderBy,
				orderByDescending: opts.desc ? "true" : undefined,
				filters: opts.filters?.length ? JSON.stringify(opts.filters) : undefined,
			},
		});
	}

	searchRecords(spec: string, query: string, limit = 50): Promise<UnivelopRecord[] | { data?: UnivelopRecord[] }> {
		return this.request("GET", this.#ws(`/records/${encodeURIComponent(spec)}/search`), { query: { query, limit } });
	}

	createRecord(spec: string, data: Record<string, unknown>): Promise<UnivelopRecord> {
		return this.request("POST", this.#ws(`/records/${encodeURIComponent(spec)}`), { body: data });
	}

	updateRecord(spec: string, id: string, data: Record<string, unknown>): Promise<UnivelopRecord> {
		return this.request("PATCH", this.#ws(`/records/${encodeURIComponent(spec)}/${encodeURIComponent(id)}`), { body: data });
	}

	runWorkflow(nameOrId: string, payload: unknown, triggerSpecId?: string): Promise<{ message?: string }> {
		return this.request("POST", this.#ws(`/workflows/${encodeURIComponent(nameOrId)}/run`), {
			query: { triggerSpecId },
			body: payload ?? {},
		});
	}

	runWorkflowAndWait(
		nameOrId: string,
		payload: unknown,
		triggerSpecId?: string,
	): Promise<{ executionId?: string; returnValue?: Record<string, unknown> }> {
		return this.request("POST", this.#ws(`/workflows/${encodeURIComponent(nameOrId)}/run-and-wait`), {
			query: { triggerSpecId },
			body: payload ?? {},
			timeoutMs: 120_000,
		});
	}

	lastExecution(nameOrId: string): Promise<Record<string, unknown> | null> {
		return this.request("GET", this.#ws(`/workflows/${encodeURIComponent(nameOrId)}/lastExecution`));
	}
}
