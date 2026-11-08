import { useEffect, useState } from "react";
import { costText, get, usd, type CaseFull } from "./api";

type Ov = {
  overview: { what_happened: string; why_raised: string; next_step: string; owner: string; unknowns: string[];
    evidence: { statement: string; label: string; cites: string[] }[]; severity: { level: string; reason: string };
    how_much: { potential_exposure: number; invoice_count: number; unsupported_by_receipts: number; to_unverified_changed_account: number;
      pending_payment: number | null; on_hold: number | null; already_paid: number | null;
      lines: { invoice_id: string; supplier_id: string; amount: number; billed_qty: number; received_qty: number; payment_status: string }[] } };
  actions: { id: string; label: string; target_ids: string[]; owner: string; expected_outcome?: string; due?: string; decision: string | null;
    decided_by?: string; status: string; lifecycle: { stage: string; state: string }[] }[];
  criteria?: { test: string; status: string; explanation: string }[];
};

const STATUS_TEXT: Record<string, string> = {
  new: "Not yet investigated", investigating: "Investigation in progress", awaiting_approval: "Awaiting your decision",
  remediation: "Approved, remediation in progress", closed: "Closed after verification", closed_override: "Closed by documented override", error: "Investigation paused",
};

export function Memo({ id }: { id: string }) {
  const [c, setC] = useState<CaseFull | null>(null);
  const [ov, setOv] = useState<Ov | null>(null);
  useEffect(() => {
    get<CaseFull>(`/api/cases/${id}`).then(setC);
    get<Ov>(`/api/cases/${id}/overview`).then(setOv);
  }, [id]);
  if (!c || !ov) return <main className="memo-wrap"><p className="muted">Preparing the memo</p></main>;
  const o = ov.overview;
  const st = c.state;
  const checks = st.verification?.checks ?? ov.criteria ?? [];
  const failing = checks.filter((x) => x.status === "exception");
  const proposed = ov.actions.filter((a) => !a.decision);
  const rec = c.status === "awaiting_approval"
    ? `Approve ${proposed.length} action${proposed.length === 1 ? "" : "s"} before ${c.payment_run.id} releases: ${proposed.map((a) => a.label.toLowerCase()).join("; ")}.`
    : c.status === "remediation"
      ? failing.length ? `Keep the incident open. ${failing.length} closure check${failing.length === 1 ? "" : "s"} still fail${failing.length === 1 ? "s" : ""}.` : "All closure checks pass. Close the incident."
      : c.status.startsWith("closed") ? "No further action. The incident is closed and the signed record is stored." : "Wait for the investigation to finish before deciding.";
  const decided = ov.actions.filter((a) => a.decision);
  const shortChecks = (t: string) => t.replaceAll("_", " ");
  return (
    <main className="memo-wrap">
      <div className="memo-tools no-print">
        <a href={`/?case=${c.id}`}>← Back to {c.id}</a>
        <button className="primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <article className="memo">
        <header className="memo-head">
          <div className="memo-brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0b1d3a" /><path d="M7 22 C12 22 13 10 18 10 S24 16 25 16" fill="none" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" /><circle cx="25" cy="16" r="3" fill="#fff" /></svg>
            <span>Follow the Money</span></div>
          <div className="memo-meta">
            <b>Decision memo · {c.id}</b>
            <span>Prepared for Tom Okafor, Finance Director · {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
            <span>Status: {STATUS_TEXT[c.status] ?? c.status} · Severity: {o.severity.level}</span>
          </div>
        </header>
        <p className="memo-syn">Synthetic demonstration data. Northstar Manufacturing Group and every record here are fictional.</p>

        <section className="memo-rec">
          <span>Recommendation</span>
          <p>{rec}</p>
        </section>

        <section>
          <h2>What happened</h2>
          <p>{o.what_happened}</p>
          <p className="memo-small">{c.trigger}. Raised automatically by the payment-run scan: invoices at 90 to 100% of the $50,000 approval limit, grouped by the same or linked supplier.</p>
        </section>

        <section>
          <h2>How much is at stake</h2>
          <div className="memo-nums">
            <div><span>Potential exposure</span><b>{usd(o.how_much.potential_exposure)}</b></div>
            <div><span>Billed, not received</span><b>{usd(o.how_much.unsupported_by_receipts)}</b></div>
            <div><span>To an unverified new bank account</span><b>{usd(o.how_much.to_unverified_changed_account)}</b></div>
            <div><span>Confirmed loss</span><b>None</b></div>
          </div>
          <table className="memo-table">
            <thead><tr><th>Invoice</th><th>Supplier</th><th className="num">Amount</th><th>Billed vs received</th><th>Payment</th></tr></thead>
            <tbody>
              {(o.how_much.lines ?? []).map((l) => (
                <tr key={l.invoice_id}><td>{l.invoice_id}</td><td>{c.invoices.find((x) => x.invoice.id === l.invoice_id)?.supplier.legal_name ?? l.supplier_id}</td>
                  <td className="num">{usd(l.amount)}</td><td>{l.billed_qty} / {l.received_qty}</td><td>{l.payment_status}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="memo-small">Calculated by code from the ERP records, not by the AI. Potential exposure, not a loss: nothing has been paid.</p>
        </section>

        <section>
          <h2>What the evidence shows</h2>
          <ul className="memo-list">
            {o.evidence.slice(0, 6).map((f, i) => <li key={i}><em className={`ml-${f.label}`}>{f.label}</em>{f.statement} <span className="memo-src">{f.cites.slice(0, 4).join(", ")}</span></li>)}
          </ul>
        </section>

        {(st.hypotheses?.length ?? 0) > 0 && (
          <section>
            <h2>Explanations tested</h2>
            <ul className="memo-list">
              {st.hypotheses!.map((h) => <li key={h.id}><em className={`ml-${h.status}`}>{h.status}</em><b>{h.kind === "benign" ? "Harmless: " : "Concerning: "}</b>{h.statement}</li>)}
            </ul>
          </section>
        )}

        <section>
          <h2>{c.status === "awaiting_approval" ? "What you are approving" : "Actions and decisions"}</h2>
          <table className="memo-table">
            <thead><tr><th>Action</th><th>Owner</th><th>Expected outcome</th><th>Decision</th></tr></thead>
            <tbody>
              {ov.actions.map((a) => (
                <tr key={a.id}><td>{a.label}<div className="memo-src">{a.target_ids.join(", ")}</div></td><td>{a.owner}</td><td>{a.expected_outcome ?? ""}</td>
                  <td>{a.decision ? `${a.decision === "approved" ? "Approved" : "Rejected"} by ${a.decided_by}` : "☐ Approve   ☐ Reject"}
                    <div className="memo-src">{a.lifecycle.map((s) => s.stage).join(" → ")}</div></td></tr>
              ))}
            </tbody>
          </table>
          <p className="memo-small">No action can pay anyone. Payments only move if a person releases them in the ERP.</p>
        </section>

        {checks.length > 0 && (
          <section>
            <h2>Closure checks</h2>
            <ul className="memo-checks">
              {checks.map((x) => <li key={x.test} className={x.status === "exception" ? "fail" : "ok"}><b>{x.status === "exception" ? "✕" : "✓"} {shortChecks(x.test)}</b> {x.explanation}</li>)}
            </ul>
            <p className="memo-small">The incident can only close when every check passes, or a named person records an override with a reason.</p>
          </section>
        )}

        {o.unknowns.length > 0 && (
          <section>
            <h2>Still unknown</h2>
            <ul className="memo-list plain">{o.unknowns.slice(0, 4).map((u) => <li key={u}>{u}</li>)}</ul>
          </section>
        )}

        <section className="memo-sign">
          {decided.length > 0 ? (
            <p>Decisions recorded in the audit trail by {[...new Set(decided.map((a) => a.decided_by))].join(", ")}.</p>
          ) : (
            <div className="memo-lines"><span>Decision by</span><span>Signature</span><span>Date</span></div>
          )}
          <p className="memo-small">Next step: {o.next_step} · Owner: {o.owner}</p>
          <p className="memo-small">Source: Follow the Money audit log for {c.id} · model cost {costText(c.cost)} · {st.report ? `signed report sha256 ${st.report.sha256.slice(0, 16)}…` : "full record available as an export"}</p>
        </section>
      </article>
    </main>
  );
}
