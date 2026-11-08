export type Ev = { seq: number; at: string; agent: string; type: string; text: string; data: Record<string, any> };
export type Cost = { calls: number; tokens: number; cost_usd: number | null; unpriced_calls: number };
export type CaseRow = {
  id: string; title: string; status: string; opened_at: string; invoice_ids: string[]; supplier_ids: string[];
  trigger: string; potential_exposure: number; template: string | null; summary: string | null; cost: Cost;
  severity?: { level: string; reason: string }; owner?: string;
};
export type Control = { id: string; test: string; policy: string; status: string; explanation: string; records: string[]; run_by?: string };
export type Evidence = { id: string; source_id: string; fact: string; excerpt: string; trust: string; label: string };
export type Hypothesis = { id: string; statement: string; kind: string; supporting: string[]; contradicting: string[]; status: string; what_would_settle_it: string };
export type Action = {
  id: string; kind: string; label: string; target_ids: string[]; owner: string; rationale: string; cites: string[];
  decision: string | null; decided_by?: string; reason?: string; status: string; acknowledged_by?: string;
};
export type ExposureLine = {
  invoice_id: string; supplier_id: string; amount: number; in_payment_run: number; payment_status: string; billed_qty: number;
  received_qty: number; unit_price: number; unsupported_value: number; formula: string; to_recently_changed_account: boolean; records: string[];
};
export type State = {
  plan?: { objective: string; questions: string[]; assignments: { agent: string; task: string }[] };
  evidence?: Evidence[]; evidence_rejected?: any[]; links?: any[]; lookalikes?: any[]; relationship_summary?: string;
  controls?: Control[]; control_notes?: string;
  exposure?: { lines: ExposureLine[]; total_in_run: number; unsupported_by_receipts: number; to_unverified_changed_account: number; formula: string; note: string; run_id: string };
  hypotheses?: Hypothesis[]; unknowns?: string[];
  briefing?: { headline: string; findings: { statement: string; label: string; cites: string[] }[]; assessment: string; assessment_by_code: string };
  actions?: Action[]; remediation_docs?: string[];
  verification?: { checks: Control[]; may_close: boolean; agent?: { recommendation: string; reasons: string[] }; at: string; last_refusal?: string };
  closure?: { by: string; at: string; override_reason: string | null };
  report?: { key: string; sha256: string; bytes: number };
  summary?: string | null;
};
export type Doc = { id: string; kind: string; title: string; trust: string; related: string[]; s3_key: string; sha256: string; scope: string };
export type CaseFull = CaseRow & {
  state: State; waiting_for: string | null; busy: boolean; invoices: any[]; documents: Doc[]; world_now: string;
  payment_run: { id: string; scheduled_for: string; name: string };
};
export type Overview = {
  world_now: string; payment_run: { id: string; scheduled_for: string; name: string; payments: number; total: number };
  approval_limit: number; currency: string; counts: Record<string, number>; documents: number; cases: CaseRow[];
  infrastructure: { compute: string; database: string; object_storage: string; inference: string; models: { specialists: string; challenge: string; backup: string } };
};
export type Graph = { nodes: { id: string; kind: string; label: string; sub: string; col: number; flag: string | null }[]; edges: { from: string; to: string; label: string; kind: string; link_id?: string; ref?: string }[]; investigated: boolean };

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Request failed (${r.status})`);
  return r.json();
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Request failed (${r.status})`);
  return r.json();
}

export const usd = (n: number | null | undefined, cents = false) =>
  n == null ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 });

export const costText = (c?: Cost) => {
  if (!c || !c.calls) return "–";
  if (c.cost_usd == null) return `${c.tokens.toLocaleString()} tokens`;
  return `$${c.cost_usd < 0.01 ? c.cost_usd.toFixed(4) : c.cost_usd.toFixed(3)}`;
};

export function hoursUntil(from: string, to: string) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 36e5);
}

export const STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "New", tone: "slate" },
  investigating: { label: "Investigating", tone: "blue" },
  awaiting_approval: { label: "Awaiting approval", tone: "amber" },
  remediation: { label: "Remediation", tone: "amber" },
  closed: { label: "Closed · verified", tone: "green" },
  closed_override: { label: "Closed · override", tone: "red" },
  error: { label: "Error", tone: "red" },
};
