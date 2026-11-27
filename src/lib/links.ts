/**
 * Deep links into the Univelop web app (hash routing).
 * Lists are addressed by their list (recordSpec) id, not the techName.
 */
export type OpenTarget = {
	view?: "list" | "kanban" | "record" | "home" | "flows";
	listId?: string;
	tileSpecId?: string;
	recordId?: string;
};

export function buildAppUrl(appBaseUrl: string, workspaceId: string, t: OpenTarget): string {
	const ws = `${appBaseUrl.replace(/\/+$/, "")}/#/ws/${encodeURIComponent(workspaceId)}`;
	const q = (params: Record<string, string | undefined>) => {
		const s = Object.entries(params)
			.filter(([, v]) => v)
			.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
			.join("&");
		return s ? `?${s}` : "";
	};

	switch (t.view) {
		case "flows":
			return `${ws}/flows/history`;
		case "home":
			return ws;
		case "kanban":
			if (!t.listId) return ws;
			return `${ws}/kanban/${encodeURIComponent(t.listId)}`;
		case "record":
			if (!t.listId || !t.recordId) return ws;
			return `${ws}/records/${encodeURIComponent(t.listId)}/${encodeURIComponent(t.recordId)}`;
		case "list":
		default:
			if (!t.listId) return ws;
			return `${ws}/records-list/${encodeURIComponent(t.listId)}${q({ tileSpecId: t.tileSpecId, selectedRecordId: t.recordId })}`;
	}
}
