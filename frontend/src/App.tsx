import { useEffect, useState } from "react";
import { costText, get, hoursUntil, STATUS, usd, type Overview } from "./api";
import { CaseView } from "./Case";
import { PersonaProvider, PersonaSwitch } from "./ctx";
import { Landing, Mark, myRuns, startDemo } from "./Landing";
import { SupplierPage } from "./Supplier";
import { Memo } from "./Memo";
import { ScanPage } from "./Scan";

export function App() {
  const params = new URLSearchParams(location.search);
  const caseId = params.get("case");
  const supplierId = params.get("supplier");
  const memoId = params.get("memo");
  if (memoId) return <Memo id={memoId} />;
  const view = params.get("view");
  if (!caseId && !supplierId && view !== "incidents" && view !== "scan") return <Landing />;
  return (
    <PersonaProvider><div className="shell">
      <TopBar />
      <div className="synthetic">Demo workspace · synthetic data for the fictional Northstar Manufacturing Group. Nothing here can pay anyone or contact a supplier.</div>
      {caseId ? <CaseView id={caseId} /> : supplierId ? <SupplierPage id={supplierId} /> : view === "scan" ? <ScanPage /> : <Inbox />}
    </div></PersonaProvider>
  );
}

function TopBar() {
  const q = new URLSearchParams(location.search);
  const here = q.get("view") === "scan" ? "scan" : (q.get("view") === "incidents" || q.get("case") || q.get("supplier")) ? "incidents" : "";
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <Mark light />
        Follow the Money
      </a>
      <span className="tenant">Northstar Manufacturing Group · Finance Control</span>
      <nav>
        <a href="/">Home</a>
        <a href="/?view=incidents" className={here === "incidents" ? "on" : ""}>Incidents</a>
        <a href="/?view=scan" className={here === "scan" ? "on" : ""}>Scan your data</a>
      </nav>
      <PersonaSwitch />
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
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scope, setScope] = useState<"mine" | "all">("mine");

  useEffect(() => {
    const load = () => get<Overview>("/api/overview").then(setOv).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function runFresh(template: string) {
    setBusy(template);
    try {
      await startDemo(template);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  if (!ov) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading</p>}</main>;
  const run = ov.payment_run;
  const hours = hoursUntil(ov.world_now, run.scheduled_for);
  const templates = ov.cases.filter((c) => c.id === c.template).sort((a, b) => a.id.localeCompare(b.id));
  const mine = new Set(myRuns());
  const featured = new Set(ov.featured ?? []);
  const runs = ov.cases.filter((c) => c.id !== c.template)
    .filter((c) => scope === "all" || mine.has(c.id) || featured.has(c.id))
    .filter((c) => statusFilter === "all" || c.status === statusFilter)
    .filter((c) => !q || `${c.id} ${c.summary ?? ""} ${c.title}`.toLowerCase().includes(q.toLowerCase()));
  const latest = (t: string) => ov.cases.find((c) => c.template === t && mine.has(c.id)) ?? ov.cases.find((c) => c.template === t && featured.has(c.id));
  const inIncidents = templates.reduce((a, c) => a + c.potential_exposure, 0);

  return (
    <main className="page">
      <section className="inbox-head">
        <div>
          <h1>Incidents</h1>
          <p className="muted">Opened automatically by the payment-run scan. Pick one and start an investigation; the agents take about 90 seconds.</p>
        </div>
        <div className="runcard">
          <p className="eyebrow">Next payment run</p>
          <h2>{run.name}</h2>
          <div className="runnums">
            <div><strong>{usd(run.total)}</strong><span>{run.payments} payments</span></div>
            <div><strong className="amber">{hours} h</strong><span>until release</span></div>
          </div>
          <div className="split">
            <div style={{ width: `${(100 * inIncidents) / run.total}%` }} className="split-a" />
          </div>
          <p className="fine"><b className="amber">{usd(inIncidents)}</b> of this run is in open incidents; {usd(run.total - inIncidents)} is unaffected.</p>
          <p className="fine">Scan rule (code): invoices at 90 to 100% of the {usd(ov.approval_limit)} approval limit, grouped by the same or a linked supplier.</p>
        </div>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="panel">
        <div className="panel-head">
          <h2>Incidents opened by the scan</h2>
          <span className="muted">"Start investigation" runs the agents on an isolated snapshot of the ERP and documents. Holds and fixes made in a run stay in that run, so anyone can start again from the original state.</span>
        </div>
        <table className="table">
          <thead><tr><th>Incident</th><th>Pattern and reason</th><th className="num">Potential exposure</th><th>Severity</th><th>Owner</th><th>Latest run</th><th /></tr></thead>
          <tbody>
            {templates.map((c) => {
              const l = latest(c.id);
              return (
                <tr key={c.id} className="rowlink" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) location.href = `/?case=${l?.id ?? c.id}`; }}>
                  <td><a href={`/?case=${c.id}`} className="caseid">{c.id}</a><div className="sub">{c.title}</div></td>
                  <td className="trig"><span className={`pattern ${c.supplier_ids.length > 1 ? "multi" : "single"}`}>{c.supplier_ids.length > 1 ? `Multi-supplier pattern (${c.supplier_ids.length} linked)` : "Single-supplier pattern"}</span><br />{c.trigger}</td>
                  <td className="num money">{usd(c.potential_exposure)}<div className="sub">potential, not a loss</div></td>
                  <td>{c.severity && <span className={`sev sev-${c.severity.level}`} title={c.severity.reason}>{c.severity.level}</span>}</td>
                  <td className="sub">{c.owner}</td>
                  <td>{l ? <><a href={`/?case=${l.id}`} className="caseid small">{l.id}</a><br /><Pill status={l.status} /></> : <span className="muted">Not investigated</span>}</td>
                  <td className="right">
                    <button className="primary" disabled={busy !== null} onClick={() => runFresh(c.id)}>
                      {busy === c.id ? "Starting" : "Start investigation"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="fine">Statuses: <b>New</b> opened by the scan · <b>Investigating</b> agents running · <b>Awaiting approval</b> a person must decide · <b>Remediation</b> teams fixing, verification pending · <b>Closed · verified</b> all checks passed · <b>Closed · override</b> closed by a named person with a reason.</p>
      </section>

      {(
        <section className="panel">
          <div className="panel-head"><h2>Investigation runs</h2>
            <span className="muted">{scope === "mine" ? "Runs you started in this browser, plus finished examples." : "Every run on this server, including other visitors'."}</span>
            <div className="seg">
              <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>Yours and examples</button>
              <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>All runs</button>
            </div>
            <div className="filters">
              <input placeholder="Search runs" value={q} onChange={(e) => setQ(e.target.value)} />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div></div>
          <table className="table">
            <thead><tr><th>Run</th><th>Headline</th><th>Severity</th><th>Status</th><th className="num">Model cost</th><th>Age</th><th /></tr></thead>
            <tbody>
              {runs.slice(0, 15).map((c) => (
                <tr key={c.id} className="rowlink" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) location.href = `/?case=${c.id}`; }}>
                  <td><a href={`/?case=${c.id}`} className="caseid">{c.id}</a>{featured.has(c.id) && <div className="sub">Example</div>}{mine.has(c.id) && <div className="sub">Yours</div>}</td>
                  <td className="trig">{c.summary ?? c.title}</td>
                  <td>{c.severity && <span className={`sev sev-${c.severity.level}`} title={c.severity.reason}>{c.severity.level}</span>}</td>
                  <td><Pill status={c.status} /></td>
                  <td className="num mono">{costText(c.cost)}</td>
                  <td className="muted" title={new Date(c.opened_at).toLocaleString()}>{age(c.opened_at)}</td>
                  <td className="right"><a className="openlink" href={`/?case=${c.id}`}>Open →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length === 0 && <p className="pending">No runs here yet. Click <b>Start investigation</b> above; your runs appear here.</p>}
        </section>
      )}

    </main>
  );
}

export function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

function age(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}
