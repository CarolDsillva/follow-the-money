import { useEffect, useState } from "react";
import { costText, get, hoursUntil, post, STATUS, usd, type Overview } from "./api";
import { CaseView } from "./Case";

export function App() {
  const params = new URLSearchParams(location.search);
  const caseId = params.get("case");
  return (
    <div className="shell">
      <TopBar />
      <div className="synthetic">Synthetic demonstration data. Northstar Manufacturing Group, its people, suppliers and records are fictional. No real payment or message can be sent.</div>
      {caseId ? <CaseView id={caseId} /> : <Inbox />}
    </div>
  );
}

function TopBar() {
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="16" cy="16" r="3" fill="currentColor" /></svg>
        ControlRoom
      </a>
      <span className="tenant">Northstar Manufacturing Group · Finance Control</span>
      <nav>
        <a href="/">Incidents</a>
        <a href="/#how">How it works</a>
        <a href="/api/docs" target="_blank" rel="noreferrer">API</a>
      </nav>
    </header>
  );
}

export function Pill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "blue" };
  return <span className={`pill tone-${s.tone}`}>{s.label}</span>;
}

function Inbox() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const load = () => get<Overview>("/api/overview").then(setOv).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function runFresh(template: string) {
    setBusy(template);
    try {
      const { id } = await post<{ id: string }>(`/api/cases/${template}/rerun`);
      await post(`/api/cases/${id}/investigate`);
      location.href = `/?case=${id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  if (!ov) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading</p>}</main>;
  const run = ov.payment_run;
  const hours = hoursUntil(ov.world_now, run.scheduled_for);
  const templates = ov.cases.filter((c) => c.id === c.template).sort((a, b) => a.id.localeCompare(b.id));
  const runs = ov.cases.filter((c) => c.id !== c.template);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Financial control incident response</p>
          <h1>From financial alert to <em>verified</em> resolution.</h1>
          <p className="lede">An alert says something looks wrong. ControlRoom's agents work out what happened across invoices, purchase orders, supplier records,
            receipts and emails, argue against their own conclusion, scope the exposure in code, and only close the case once the controls are retested.</p>
        </div>
        <div className="runcard">
          <p className="eyebrow">Next payment run</p>
          <h2>{run.name}</h2>
          <div className="runnums">
            <div><strong>{usd(run.total)}</strong><span>{run.payments} payments</span></div>
            <div><strong className="amber">{hours} h</strong><span>until release</span></div>
          </div>
          <p className="fine">World clock {fmt(ov.world_now)}. The payment-run scan is deterministic code: near-limit invoices from the same or linked suppliers open an incident.</p>
        </div>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="panel">
        <div className="panel-head">
          <h2>Incidents opened by the scan</h2>
          <span className="muted">Each run gets its own copy of the ERP, so you can run an incident from the start yourself.</span>
        </div>
        <table className="table">
          <thead><tr><th>Incident</th><th>Trigger</th><th className="num">Potential exposure</th><th>Status</th><th /></tr></thead>
          <tbody>
            {templates.map((c) => (
              <tr key={c.id}>
                <td><a href={`/?case=${c.id}`} className="caseid">{c.id}</a><div className="sub">{c.title}</div></td>
                <td className="trig">{c.trigger}</td>
                <td className="num money">{usd(c.potential_exposure)}</td>
                <td><Pill status={c.status} /></td>
                <td className="right">
                  <button className="primary" disabled={busy !== null} onClick={() => runFresh(c.id)}>
                    {busy === c.id ? "Starting" : "Investigate a fresh copy"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {runs.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Investigation runs</h2><span className="muted">Every run, with its model cost.</span></div>
          <table className="table">
            <thead><tr><th>Run</th><th>Headline</th><th>Status</th><th className="num">Model cost</th><th>Opened</th></tr></thead>
            <tbody>
              {runs.slice(0, 15).map((c) => (
                <tr key={c.id}>
                  <td><a href={`/?case=${c.id}`} className="caseid">{c.id}</a></td>
                  <td className="trig">{c.summary ?? c.title}</td>
                  <td><Pill status={c.status} /></td>
                  <td className="num mono">{costText(c.cost)}</td>
                  <td className="muted">{new Date(c.opened_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="how" id="how">
        <h2>How it works</h2>
        <div className="flow">
          {[
            ["Incident Commander", "Plans the investigation and writes the briefing. Can't approve anything.", ov.infrastructure.models.challenge],
            ["Evidence Agent", "Follows invoice, PO, request, receipt and payment, and reads the original documents. A citation that doesn't exist is rejected.", ov.infrastructure.models.specialists],
            ["Relationship Agent", "Assesses links the deterministic matcher finds: shared bank accounts, phones, addresses, look-alike email domains.", ov.infrastructure.models.specialists],
            ["Control Agent", "Chooses and runs policy tests. Pass or fail is computed by code.", ov.infrastructure.models.specialists],
            ["Exposure engine", "Pure code. Every dollar has a formula and a source record.", "no model"],
            ["Challenge Agent", "Argues for the harmless explanation and goes looking for the proof.", ov.infrastructure.models.challenge],
            ["Resolution Agent", "Proposes actions from a fixed catalogue. Nothing runs until a person approves. There is no payment action.", ov.infrastructure.models.specialists],
            ["Verification Agent", "Retests the controls against remediation evidence. Code decides whether the case may close.", ov.infrastructure.models.specialists],
          ].map(([n, d, m]) => (
            <div className="flowcard" key={n}><h3>{n}</h3><p>{d}</p><span className="model">{m}</span></div>
          ))}
        </div>
        <h2>Running on Vultr</h2>
        <div className="infra">
          <div><h3>Cloud Compute</h3><p>{ov.infrastructure.compute}. API, LangGraph orchestrator, rules engine and ERP simulator.</p></div>
          <div><h3>Serverless Inference</h3><p>Every model call, from every agent. Costs are measured per call from Vultr's price list.</p></div>
          <div><h3>Managed PostgreSQL</h3><p>{ov.infrastructure.database}. ERP records, cases, the event log and LangGraph checkpoints, so an approval survives a restart.</p></div>
          <div><h3>Object Storage</h3><p>{ov.infrastructure.object_storage}. The {ov.documents} original invoices, emails and receipts the agents read, and the signed closing reports.</p></div>
        </div>
      </section>
    </main>
  );
}

export function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}
