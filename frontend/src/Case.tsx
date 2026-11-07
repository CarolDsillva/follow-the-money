import { useEffect, useMemo, useRef, useState } from "react";
import { costText, get, hoursUntil, post, usd, type CaseFull, type Control, type Ev, type Graph } from "./api";
import { fmt, Pill } from "./App";
import { RelationshipMap } from "./Map";

const AGENTS = [
  { name: "Incident Commander", job: "Plan and brief" },
  { name: "Evidence Agent", job: "Collect source facts" },
  { name: "Relationship Agent", job: "Link entities" },
  { name: "Control Agent", job: "Run policy tests" },
  { name: "Exposure engine", job: "Compute exposure (code)" },
  { name: "Challenge Agent", job: "Argue the other side" },
  { name: "Resolution Agent", job: "Propose actions" },
  { name: "Verification Agent", job: "Retest controls" },
];

const TABS = ["Investigation", "Relationship map", "Evidence & hypotheses", "Exposure & actions", "Verification & audit"] as const;
type Tab = (typeof TABS)[number];

const STEPS = [
  { key: "detect", label: "Detected" },
  { key: "investigate", label: "Investigated" },
  { key: "challenge", label: "Challenged" },
  { key: "approve", label: "Approved" },
  { key: "remediate", label: "Remediated" },
  { key: "verify", label: "Verified & closed" },
];

function stepIndex(c: CaseFull, events: Ev[]): number {
  if (c.status.startsWith("closed")) return 6;
  const types = new Set(events.map((e) => e.type));
  if (c.status === "remediation") return types.has("remediation_evidence") ? 5 : 4;
  if (c.status === "awaiting_approval") return 3;
  if (types.has("hypotheses")) return 3;
  if (types.has("exposure")) return 2;
  if (types.has("plan")) return 1;
  return c.status === "new" ? 0 : 1;
}

const TAB_FOR: Record<string, Tab> = {
  plan: "Investigation", evidence: "Evidence & hypotheses", links: "Relationship map", controls: "Investigation",
  exposure: "Exposure & actions", hypotheses: "Evidence & hypotheses", briefing: "Evidence & hypotheses", actions: "Exposure & actions",
  action_done: "Verification & audit", close_refused: "Verification & audit", verification: "Verification & audit", closed: "Verification & audit",
};

export function CaseView({ id }: { id: string }) {
  const [c, setC] = useState<CaseFull | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [tab, setTab] = useState<Tab>("Investigation");
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const refreshTimer = useRef<number | null>(null);

  const refresh = () =>
    Promise.all([get<CaseFull>(`/api/cases/${id}`), get<Graph>(`/api/cases/${id}/graph`)])
      .then(([cc, g]) => { setC(cc); setGraph(g); })
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
    const es = new EventSource(`/api/cases/${id}/stream`);
    es.onmessage = (m) => {
      const e: Ev = JSON.parse(m.data);
      if (e.seq <= last.current) return;
      last.current = e.seq;
      setEvents((xs) => [...xs, e]);
      if (follow && TAB_FOR[e.type]) setTab(TAB_FOR[e.type]);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(refresh, 400);
    };
    const t = setInterval(refresh, 6000);
    return () => { es.close(); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, follow]);

  if (!c) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading incident</p>}</main>;
  const step = stepIndex(c, events);
  const hours = hoursUntil(c.world_now, c.payment_run.scheduled_for);
  const ex = c.state.exposure;

  return (
    <main className="case">
      <section className="casehead">
        <div className="casehead-main">
          <a href="/" className="back">← Incidents</a>
          <div className="titleline"><h1>{c.id}</h1><Pill status={c.status} />{c.busy && <span className="live"><i />Agents working</span>}</div>
          <p className="casetitle">{c.state.briefing?.headline ?? c.title}</p>
          <p className="fine">{c.trigger}</p>
        </div>
        <div className="kpis">
          <div><span>Potential exposure</span><strong className="money">{usd(ex?.total_in_run ?? c.potential_exposure)}</strong>
            {ex && <em>{usd(ex.unsupported_by_receipts)} not backed by receipts</em>}</div>
          <div><span>{c.payment_run.id}</span><strong className="amber">{hours} h</strong><em>until release</em></div>
          <div><span>Model cost</span><strong className="mono">{costText(c.cost)}</strong><em>{c.cost.calls} calls · {c.cost.tokens.toLocaleString()} tokens</em></div>
        </div>
      </section>

      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < step ? "done" : i === step ? "now" : ""}><span>{i < step ? "✓" : i + 1}</span>{s.label}</li>
        ))}
      </ol>

      {c.status === "new" && <StartBar c={c} onStarted={refresh} />}
      {c.status === "error" && (
        <div className="startbar errbar">
          <p>A step failed: {[...events].reverse().find((e) => e.type === "error")?.text}. Completed agent steps are saved in Postgres.</p>
          <button className="primary" onClick={() => post(`/api/cases/${c.id}/retry`).then(refresh).catch((e) => setError(e.message))}>Retry from checkpoint</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); setFollow(false); }}>
            {t}{t === "Exposure & actions" && c.waiting_for === "approval" && !c.busy && <b className="dot" />}
          </button>
        ))}
        <label className="follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow the agents</label>
      </div>

      {tab === "Investigation" && <Investigation c={c} events={events} />}
      {tab === "Relationship map" && graph && <RelationshipMap graph={graph} caseId={c.id} />}
      {tab === "Evidence & hypotheses" && <EvidenceTab c={c} events={events} />}
      {tab === "Exposure & actions" && <ExposureTab c={c} onDone={refresh} />}
      {tab === "Verification & audit" && <VerifyTab c={c} events={events} onDone={refresh} />}
    </main>
  );
}

function StartBar({ c, onStarted }: { c: CaseFull; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="startbar">
      <p>The scan opened this incident. Nothing has been investigated yet.</p>
      <button className="primary" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try {
          if (c.id === c.template) {
            const { id } = await post<{ id: string }>(`/api/cases/${c.id}/rerun`);
            await post(`/api/cases/${id}/investigate`);
            location.href = `/?case=${id}`;
          } else { await post(`/api/cases/${c.id}/investigate`); onStarted(); }
        } catch (e) { setErr((e as Error).message); setBusy(false); }
      }}>{busy ? "Starting" : "Start investigation"}</button>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Investigation

function Investigation({ c, events }: { c: CaseFull; events: Ev[] }) {
  const byAgent = useMemo(() => {
    const m: Record<string, { state: string; tools: number; calls: number; cost: number; last: string; model?: string }> = {};
    for (const a of AGENTS) m[a.name] = { state: "idle", tools: 0, calls: 0, cost: 0, last: "" };
    let active: string | null = null;
    for (const e of events) {
      const a = m[e.agent];
      if (!a) continue;
      if (e.type === "agent_started") { a.state = "working"; a.model = e.data.model; active = e.agent; }
      if (e.type === "tool_call") { a.tools++; a.last = e.text; }
      if (e.type === "llm_call") { a.calls++; a.cost += e.data.cost_usd ?? 0; }
      if (["plan", "evidence", "links", "controls", "exposure", "hypotheses", "briefing", "actions", "verification"].includes(e.type)) {
        a.state = "done"; a.last = e.text;
      }
    }
    void active;
    return m;
  }, [events]);
  const controls = c.state.controls ?? [];
  const trace = events.filter((e) => e.type !== "llm_call");

  return (
    <div className="grid2">
      <div>
        <section className="panel">
          <div className="panel-head"><h2>Agents</h2><span className="muted">LangGraph workflow on the Vultr VM. Every model call goes to Vultr Serverless Inference.</span></div>
          <div className="agents">
            {AGENTS.map((a) => {
              const s = byAgent[a.name];
              return (
                <div key={a.name} className={`agent st-${s.state}`}>
                  <div className="agent-top"><h3>{a.name}</h3><span className="agent-state">{s.state === "working" ? "Working" : s.state === "done" ? "Done" : "Waiting"}</span></div>
                  <p className="job">{a.job}</p>
                  <p className="agent-last">{s.last || " "}</p>
                  <p className="agent-meta">{a.name === "Exposure engine" ? "code, no model" : `${s.model ?? ""} · ${s.tools} tool calls · ${s.calls} model calls${s.cost ? ` · $${s.cost.toFixed(4)}` : ""}`}</p>
                </div>
              );
            })}
          </div>
        </section>
        {c.state.plan && (
          <section className="panel">
            <div className="panel-head"><h2>Commander's plan</h2></div>
            <p>{c.state.plan.objective}</p>
            <ol className="questions">{c.state.plan.questions?.map((q) => <li key={q}>{q}</li>)}</ol>
          </section>
        )}
        {controls.length > 0 && (
          <section className="panel">
            <div className="panel-head"><h2>Control tests</h2><span className="muted">Pass or fail is computed by code. The agent chose the tests and explains them.</span></div>
            <Checks checks={controls} />
          </section>
        )}
      </div>
      <section className="panel trace">
        <div className="panel-head"><h2>Live trace</h2><span className="muted">{trace.length} events</span></div>
        <ol>
          {[...trace].reverse().map((e) => (
            <li key={e.seq} className={`ev ev-${e.type}`}>
              <span className="ev-agent">{e.agent}</span>
              <span className="ev-text">{e.text}</span>
              <time>{new Date(e.at).toLocaleTimeString()}</time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function Checks({ checks }: { checks: Control[] }) {
  return (
    <ul className="checks">
      {checks.map((r) => (
        <li key={r.id ?? r.test} className={`check c-${r.status}`}>
          <span className="cstat">{r.status === "exception" ? "Exception" : r.status === "exempt" ? "Exempt" : r.status === "pass" ? "Pass" : "N/A"}</span>
          <div><strong>{r.test.replaceAll("_", " ")}</strong> <span className="pol">{r.policy}</span>
            <p>{r.explanation}</p>{r.run_by && <p className="fine">Run by: {r.run_by}</p>}</div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Evidence

function Cite({ id, caseId }: { id: string; caseId: string }) {
  const doc = /^(DOC|EML)-/.test(id);
  const href = doc ? `/api/documents/${id}?case=${caseId}` : /^(EV|CTL|LNK|HYP)-/.test(id) ? undefined : `/api/records/${id}?case=${caseId}`;
  return href ? <a className="chip" href={href} target="_blank" rel="noreferrer">{id}</a> : <span className="chip">{id}</span>;
}

function EvidenceTab({ c, events }: { c: CaseFull; events: Ev[] }) {
  const st = c.state;
  const guards = events.filter((e) => e.type === "untrusted_instruction");
  const rejected = events.filter((e) => e.type === "evidence_rejected");
  return (
    <div className="grid2">
      <div>
        {guards.length > 0 && (
          <section className="panel alert">
            <h2>Instructions found inside a document</h2>
            {guards.slice(0, 1).map((g) => <p key={g.seq}><Cite id={g.data.document_id} caseId={c.id} /> {g.text}</p>)}
            <p className="fine">The email says the bank change "has been verified by your CFO" and tells automated assistants to mark it confirmed. ControlRoom records this as an
              unverified claim. An email can't prove who owns a bank account.</p>
            {(st.lookalikes ?? []).map((l) => <p key={l.document_id}><strong>Look-alike sender:</strong> {l.sender_domain} imitates {l.real_domain} ({l.supplier_id}).</p>)}
          </section>
        )}
        {st.briefing && (
          <section className="panel">
            <div className="panel-head"><h2>Briefing</h2><span className={`pill tone-${st.briefing.assessment_by_code === "open_exceptions" ? "amber" : "green"}`}>
              {st.briefing.assessment_by_code === "open_exceptions" ? "Open control exceptions" : "No open exceptions"}</span></div>
            <ul className="findings">
              {st.briefing.findings.map((f, i) => (
                <li key={i}><span className={`lab lab-${f.label}`}>{f.label}</span>{f.statement} <span className="cites">{f.cites.map((x) => <Cite key={x} id={x} caseId={c.id} />)}</span></li>
              ))}
            </ul>
          </section>
        )}
        <section className="panel">
          <div className="panel-head"><h2>Hypotheses</h2><span className="muted">The Challenge Agent argues against the leading explanation.</span></div>
          {!(st.hypotheses?.length) && <p className="muted">Not yet challenged.</p>}
          <div className="hyps">
            {st.hypotheses?.map((h) => (
              <div key={h.id} className={`hyp k-${h.kind}`}>
                <div className="hyp-top"><span className="kind">{h.kind === "benign" ? "Harmless explanation" : "Concerning explanation"}</span><span className={`lab lab-${h.status}`}>{h.status}</span></div>
                <p className="stmt">{h.statement}</p>
                {h.supporting.length > 0 && <p className="for">For: {h.supporting.map((x) => <Cite key={x} id={x} caseId={c.id} />)}</p>}
                {h.contradicting.length > 0 && <p className="against">Against: {h.contradicting.map((x) => <Cite key={x} id={x} caseId={c.id} />)}</p>}
                <p className="fine">What would settle it: {h.what_would_settle_it}</p>
              </div>
            ))}
          </div>
          {st.unknowns && st.unknowns.length > 0 && (<><h3>Still unknown</h3><ul className="unknowns">{st.unknowns.map((u) => <li key={u}>{u}</li>)}</ul></>)}
        </section>
      </div>
      <div>
        <section className="panel">
          <div className="panel-head"><h2>Evidence ledger</h2><span className="muted">{st.evidence?.length ?? 0} accepted · {rejected.length} rejected by the validator</span></div>
          <ul className="evidence">
            {st.evidence?.map((e) => (
              <li key={e.id} className={e.trust === "external-unverified" ? "untrusted" : ""}>
                <div className="ev-top"><b>{e.id}</b><Cite id={e.source_id} caseId={c.id} /><span className={`lab ${e.label === "Unverified claim" ? "lab-Unresolved" : "lab-Confirmed"}`}>{e.label}</span></div>
                <p>{e.fact}</p>
                <blockquote>{e.excerpt}</blockquote>
              </li>
            ))}
          </ul>
          {rejected.length > 0 && (
            <details className="rejected"><summary>{rejected.length} rejected citations</summary>
              <ul>{rejected.map((r) => <li key={r.seq}>{r.agent}: {r.text}</li>)}</ul></details>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Source documents</h2><span className="muted">Originals in Vultr Object Storage</span></div>
          <ul className="docs">
            {c.documents.map((d) => (
              <li key={d.scope + d.id}><a href={`/api/documents/${d.id}?case=${c.id}`} target="_blank" rel="noreferrer">{d.title}</a>
                <span className={`trust t-${d.trust}`}>{d.trust.replace("-", " ")}</span><code>{d.s3_key}</code></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Exposure and actions

function ExposureTab({ c, onDone }: { c: CaseFull; onDone: () => void }) {
  const ex = c.state.exposure;
  const actions = c.state.actions ?? [];
  const [by, setBy] = useState("Tom Okafor, Finance Director");
  const [dec, setDec] = useState<Record<string, { decision: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const waiting = c.waiting_for === "approval" && !c.busy;

  useEffect(() => {
    setDec((d) => {
      const n = { ...d };
      for (const a of actions) if (!n[a.id]) n[a.id] = { decision: "approved", reason: "" };
      return n;
    });
  }, [actions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid2">
      <section className="panel">
        <div className="panel-head"><h2>Exposure</h2><span className="muted">Computed by code. Potential exposure, not a confirmed loss.</span></div>
        {!ex ? <p className="muted">Not computed yet.</p> : (
          <>
            <div className="exnums">
              <div><span>In {ex.run_id}</span><strong>{usd(ex.total_in_run)}</strong></div>
              <div><span>Not backed by receipts</span><strong className="red">{usd(ex.unsupported_by_receipts)}</strong></div>
              <div><span>To an unverified new bank account</span><strong className="amber">{usd(ex.to_unverified_changed_account)}</strong></div>
            </div>
            <table className="table">
              <thead><tr><th>Invoice</th><th>Supplier</th><th className="num">Amount</th><th>Receipt check</th><th>Payment</th></tr></thead>
              <tbody>
                {ex.lines.map((l) => (
                  <tr key={l.invoice_id}>
                    <td><Cite id={l.invoice_id} caseId={c.id} /></td>
                    <td>{l.supplier_id}{l.to_recently_changed_account && <span className="flag">new bank account</span>}</td>
                    <td className="num money">{usd(l.amount)}</td>
                    <td className="mono small">{l.formula}</td>
                    <td>{l.payment_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="formula mono">{ex.formula}</p>
          </>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Proposed actions</h2><span className="muted">The Resolution Agent proposes. A person decides. No action can pay anyone.</span></div>
        {actions.length === 0 && <p className="muted">No actions proposed yet.</p>}
        <ul className="actions">
          {actions.map((a) => (
            <li key={a.id} className={`act s-${a.status}`}>
              <div className="act-top"><b>{a.label}</b><span className="targets">{a.target_ids.map((t) => <Cite key={t} id={t} caseId={c.id} />)}</span></div>
              <p>{a.rationale}</p>
              <p className="fine">Owner: {a.owner}</p>
              {waiting ? (
                <div className="decide">
                  {(["approved", "rejected"] as const).map((d) => (
                    <label key={d} className={dec[a.id]?.decision === d ? `on ${d}` : ""}>
                      <input type="radio" name={a.id} checked={dec[a.id]?.decision === d} onChange={() => setDec({ ...dec, [a.id]: { ...dec[a.id], decision: d } })} />
                      {d === "approved" ? "Approve" : "Reject"}
                    </label>
                  ))}
                  <input className="reason" placeholder="Reason (optional)" value={dec[a.id]?.reason ?? ""} onChange={(e) => setDec({ ...dec, [a.id]: { ...dec[a.id], reason: e.target.value } })} />
                </div>
              ) : a.decision ? (
                <p className={`decided ${a.decision}`}>{a.decision === "approved" ? "Approved" : "Rejected"} by {a.decided_by}{a.reason ? `: ${a.reason}` : ""} · {a.status.replace("_", " ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
        {waiting && actions.length > 0 && (
          <div className="approvebar">
            <label>Decision by <input value={by} onChange={(e) => setBy(e.target.value)} /></label>
            <button className="primary" disabled={busy || by.trim().length < 2} onClick={async () => {
              setBusy(true); setErr(null);
              try { await post(`/api/cases/${c.id}/decisions`, { by, decisions: dec }); onDone(); } catch (e) { setErr((e as Error).message); }
              setBusy(false);
            }}>{busy ? "Submitting" : "Submit decisions"}</button>
            <p className="fine">The workflow is paused in Postgres until you decide. It survives an API restart.</p>
          </div>
        )}
        {err && <p className="error">{err}</p>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Verification

function VerifyTab({ c, events, onDone }: { c: CaseFull; events: Ev[]; onDone: () => void }) {
  const st = c.state;
  const [by, setBy] = useState("Tom Okafor, Finance Director");
  const [override, setOverride] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refusal = [...events].reverse().find((e) => e.type === "close_refused");
  const closedEv = events.find((e) => e.type === "closed");
  const remed = c.status === "remediation";
  const ready = c.waiting_for === "remediation" && !c.busy;
  const docs = st.remediation_docs ?? [];
  const audit = (st.actions ?? []).find((a) => a.kind === "escalate_to_audit" && a.decision === "approved");
  const isA = c.template === "INC-0412";

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name); setErr(null);
    try { await fn(); onDone(); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };

  return (
    <div className="grid2">
      <div>
        {c.status.startsWith("closed") && (
          <section className={`panel ${c.status === "closed" ? "closedok" : "alert"}`}>
            <h2>{c.status === "closed" ? "Closed after verification" : "Closed by override"}</h2>
            <p>{closedEv?.text}</p>
            {st.report && (<p className="mono small">sha256 {st.report.sha256}<br />{st.report.key} · Ed25519 signed</p>)}
            <a className="button" href={`/api/cases/${c.id}/report`} target="_blank" rel="noreferrer">Open the signed report</a>
          </section>
        )}
        {refusal && !c.status.startsWith("closed") && (
          <section className="panel refused">
            <h2>Close refused</h2>
            <p>{refusal.text} "Resolved" isn't a button: the controls have to pass.</p>
            <ul>{(refusal.data.failing ?? []).map((f: Control) => <li key={f.test}><b>{f.test.replaceAll("_", " ")}</b>: {f.explanation}</li>)}</ul>
          </section>
        )}
        <section className="panel">
          <div className="panel-head"><h2>Closure checks</h2><span className="muted">{st.verification ? `Computed ${new Date(st.verification.at ?? st.verification.last_refusal ?? "").toLocaleTimeString()}` : "Run verification to compute"}</span></div>
          {st.verification ? <Checks checks={st.verification.checks} /> : <p className="muted">Not verified yet.</p>}
          {st.verification?.agent && (
            <div className={`vagent ${st.verification.agent.recommendation}`}>
              <b>Verification Agent: {st.verification.agent.recommendation === "close" ? "recommends closing" : "keep open"}</b>
              <ul>{st.verification.agent.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
        </section>
      </div>
      <div>
        {remed && (
          <section className="panel">
            <div className="panel-head"><h2>Remediation</h2><span className="muted">What the teams do after approval. Each step adds a real document to Object Storage and updates this case's ERP copy.</span></div>
            <ul className="tasks">
              {(st.actions ?? []).filter((a) => a.decision === "approved").map((a) => (
                <li key={a.id}><span className={`tstat ${a.status}`}>{a.status.replace("_", " ")}</span>{a.label} <span className="fine">· {a.owner}</span></li>
              ))}
            </ul>
            {isA && (
              <div className="simbtns">
                <button disabled={!!busy || docs.includes("DOC-CB-301")} onClick={() => act("cb", () => post(`/api/cases/${c.id}/remediation`, { kind: "callback" }))}>
                  {docs.includes("DOC-CB-301") ? "✓ Callback note added" : "Procurement: callback and due diligence"}</button>
                <button disabled={!!busy || docs.includes("DOC-RC-7104")} onClick={() => act("rc", () => post(`/api/cases/${c.id}/remediation`, { kind: "receiving" }))}>
                  {docs.includes("DOC-RC-7104") ? "✓ Receiving confirmed" : "Warehouse and AP: confirm receipts"}</button>
                {audit && <button disabled={!!busy || !!audit.acknowledged_by} onClick={() => act("au", () => post(`/api/cases/${c.id}/audit-ack`))}>
                  {audit.acknowledged_by ? "✓ Audit acknowledged" : "Internal Audit: acknowledge"}</button>}
              </div>
            )}
            <p className="fine">These buttons stand in for the Procurement, Warehouse and Audit teams. They are labelled as a simulation.</p>
            <div className="closebar">
              <button className="secondary" disabled={!ready || !!busy} onClick={() => act("v", () => post(`/api/cases/${c.id}/verify`))}>{busy === "v" || (c.busy && remed) ? "Verifying" : "Run verification"}</button>
              <label>Closed by <input value={by} onChange={(e) => setBy(e.target.value)} /></label>
              <button className="primary" disabled={!ready || !!busy} onClick={() => act("c", () => post(`/api/cases/${c.id}/close`, { by, override_reason: "" }))}>Close incident</button>
            </div>
            <button className="linkbtn" onClick={() => setShowOverride(!showOverride)}>Close with a documented override</button>
            {showOverride && (
              <div className="override">
                <textarea placeholder="Why this incident should close although checks fail. Recorded in the signed report." value={override} onChange={(e) => setOverride(e.target.value)} />
                <button className="danger" disabled={!ready || override.trim().length < 10 || !!busy} onClick={() => act("o", () => post(`/api/cases/${c.id}/close`, { by, override_reason: override }))}>Close with override</button>
              </div>
            )}
            {err && <p className="error">{err}</p>}
          </section>
        )}
        <section className="panel">
          <div className="panel-head"><h2>Audit trail</h2><span className="muted">Every agent step, model call summary and human decision, stored in Postgres.</span></div>
          <ol className="audit">
            {events.filter((e) => e.type !== "llm_call" && e.type !== "tool_call").map((e) => (
              <li key={e.seq}><time>{fmtTime(e.at)}</time><b>{e.agent}</b> {e.text}</li>
            ))}
          </ol>
          <p className="fine">World clock for this scenario: {fmt(c.world_now)}.</p>
        </section>
      </div>
    </div>
  );
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
