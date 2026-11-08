import React, { useEffect, useMemo, useRef, useState } from "react";
import { costText, get, hoursUntil, post, usd, type CaseFull, type Control, type Ev, type Graph } from "./api";
import { fmt, Pill } from "./App";
import { Cite, DrawerProvider, PERSONAS, ROLE_CAN, ROLE_COLOR, usePersona } from "./ctx";
import { NetworkExplorer, type Focus } from "./Network";
import { startDemo } from "./Landing";
import { CASE_TOUR, Tour } from "./Tour";

const AGENTS = [
  { name: "Incident Commander", job: "Plan and brief", after: "the incident to open" },
  { name: "Evidence Agent", job: "Collect source facts", after: "the Commander's plan" },
  { name: "Relationship Agent", job: "Link entities", after: "the Evidence Agent" },
  { name: "Control Agent", job: "Run policy tests", after: "the Evidence Agent" },
  { name: "Exposure engine", job: "Compute exposure (code)", after: "the Relationship and Control Agents" },
  { name: "Challenge Agent", job: "Argue the other side", after: "exposure to be computed" },
  { name: "Resolution Agent", job: "Propose actions", after: "the Commander's briefing" },
  { name: "Verification Agent", job: "Retest controls", after: "approval and remediation evidence" },
];

const TABS = ["Overview", "Investigation", "Timeline", "Evidence & hypotheses", "Exposure & actions", "Verification & audit"] as const;
type Tab = (typeof TABS)[number];

const STEPS = [
  { key: "detect", label: "Detected" },
  { key: "investigate", label: "Investigated" },
  { key: "challenge", label: "Challenged" },
  { key: "approve", label: "Approved" },
  { key: "remediate", label: "Remediated" },
  { key: "verify", label: "Verified & closed" },
];

type Stage = { stage: string; state: string; by?: string; at?: string; note?: string | null };
type ActionView = NonNullable<CaseFull["state"]["actions"]>[number] & { lifecycle: Stage[]; expected_outcome?: string; due?: string };
type Criteria = Control[];
type OverviewData = {
  criteria?: Criteria;
  overview: {
    what_happened: string; why_raised: string; next_step: string; owner: string; exceptions_open: string[];
    how_much: { potential_exposure: number; invoice_count: number; unsupported_by_receipts: number; to_unverified_changed_account: number;
      pending_payment: number | null; on_hold: number | null; already_paid: number | null; confirmed_loss: null; label: string };
    evidence: { statement: string; label: string; cites: string[] }[];
    competing: { id: string; kind: string; status: string; statement: string }[];
    unknowns: string[]; severity: { level: string; reason: string };
  };
  actions: ActionView[];
};
type TL = { at: string; kind: string; text: string; source_id: string; provenance: string; flag: string | null };

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
  plan: "Investigation", evidence: "Evidence & hypotheses", links: "Overview", controls: "Investigation",
  exposure: "Exposure & actions", hypotheses: "Evidence & hypotheses", briefing: "Overview", actions: "Exposure & actions",
  action_done: "Verification & audit", close_refused: "Verification & audit", verification: "Verification & audit", closed: "Overview",
};

export function CaseView({ id }: { id: string }) {
  return <DrawerProvider caseId={id}><CaseInner id={id} /></DrawerProvider>;
}

function CaseInner({ id }: { id: string }) {
  const [c, setC] = useState<CaseFull | null>(null);
  const [ov, setOv] = useState<OverviewData | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [, setGraph] = useState<Graph | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "Investigation";
  });
  const [follow, setFollow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const refreshTimer = useRef<number | null>(null);

  const refresh = () =>
    Promise.all([get<CaseFull>(`/api/cases/${id}`), get<Graph>(`/api/cases/${id}/graph`), get<OverviewData>(`/api/cases/${id}/overview`)])
      .then(([cc, g, o]) => { setC(cc); setGraph(g); setOv(o); setError(null); })
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
    es.onerror = () => setError("Live updates paused. Reconnecting…");
    es.onopen = () => setError(null);
    const t = setInterval(refresh, 6000);
    return () => { es.close(); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, follow]);

  if (!c) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading incident</p>}</main>;
  const step = stepIndex(c, events);
  const hours = hoursUntil(c.world_now, c.payment_run.scheduled_for);
  const ex = c.state.exposure;
  const sev = ov?.overview.severity;

  // jump to a tab from a button elsewhere on the page, and bring that section into view
  const openTab = (t: Tab) => {
    setTab(t); setFollow(false);
    requestAnimationFrame(() => requestAnimationFrame(() =>
      document.getElementById("case-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" })));
  };

  return (
    <main className="case">
      <section className="casehead">
        <div className="casehead-main">
          <nav className="crumbs"><a href="/">Home</a><span>›</span><a href="/?view=incidents">Incidents</a><span>›</span>
            {c.template && c.template !== c.id && <><a href={`/?case=${c.template}`}>{c.template}</a><span>›</span></>}<b>{c.id}</b></nav>
          <div className="titleline"><h1>{c.id}</h1><Pill status={c.status} />
            {sev && <span className={`sev sev-${sev.level}`} title={sev.reason}>{sev.level}</span>}
            {c.busy && <span className="live"><i />{runningAgent(events) ?? "Working"}</span>}</div>
          <p className="casetitle">{c.state.briefing?.headline ?? c.title}</p>
          <p className="fine">{c.trigger} · Owner: Elena Brandt, AP Operations Lead · <a href={`/api/cases/${c.id}/export`}>Export incident record</a></p>
          <a className="button memo-btn" href={`/?memo=${c.id}`} target="_blank" rel="noreferrer">Decision memo</a>
        </div>
        <div className="kpis" data-tour="kpis">
          <div><span>Potential exposure</span><strong className="money">{usd(ex?.total_in_run ?? c.potential_exposure)}</strong>
            <em>{ex ? `${usd(ex.unsupported_by_receipts)} not backed by receipts` : "not a confirmed loss"}</em></div>
          <div><span>{c.payment_run.id}</span><strong className="amber">{hours} h</strong><em>until release</em></div>
          <div><span>Model cost</span><strong className="mono">{costText(c.cost)}</strong><em>{c.cost.calls} calls · {c.cost.tokens.toLocaleString()} tokens</em></div>
        </div>
      </section>

      <Tour steps={CASE_TOUR} storageKey={`tour-${c.id}`} onTab={(t) => { setTab(t as Tab); setFollow(false); }}
        autoStart={new URLSearchParams(location.search).get("guide") === "1"} />
      <ol className="stepper" data-tour="stepper">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < step ? "done" : i === step ? "now" : ""}><span>{i < step ? "✓" : i + 1}</span>{s.label}</li>
        ))}
      </ol>

      <Guide c={c} events={events} actions={ov?.actions ?? []} go={openTab} />
      {c.status === "new" && <StartBar c={c} onStarted={refresh} />}
      {c.status === "error" && (
        <div className="startbar errbar">
          <p>A step failed: {[...events].reverse().find((e) => e.type === "error")?.text}. Completed agent steps are saved in Postgres, so nothing is lost.</p>
          <button className="primary" onClick={() => post(`/api/cases/${c.id}/retry`).then(refresh).catch((e) => setError(e.message))}>Retry from checkpoint</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <RoleStrip />
      <CaseNetwork c={c} events={events} />

      <div className="tabs" role="tablist" id="case-tabs">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); setFollow(false); }}>
            {t}{t === "Exposure & actions" && c.waiting_for === "approval" && !c.busy && <b className="dot" />}
          </button>
        ))}
        <label className="follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow the agents</label>
      </div>

      {tab === "Overview" && <OverviewTab c={c} ov={ov} go={openTab} />}
      {tab === "Investigation" && <Investigation c={c} events={events} />}
      {tab === "Timeline" && <TimelineTab c={c} events={events} />}
      {tab === "Evidence & hypotheses" && <EvidenceTab c={c} events={events} />}
      {tab === "Exposure & actions" && <ExposureTab c={c} actions={ov?.actions ?? []} onDone={refresh} />}
      {tab === "Verification & audit" && <VerifyTab c={c} events={events} actions={ov?.actions ?? []} criteria={ov?.criteria ?? []} onDone={refresh} />}
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
            await startDemo(c.id);
          } else { await post(`/api/cases/${c.id}/investigate`); onStarted(); }
        } catch (e) { setErr((e as Error).message); setBusy(false); }
      }}>{busy ? "Starting" : "Start investigation"}</button>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Overview

function OverviewTab({ c, ov, go }: { c: CaseFull; ov: OverviewData | null; go: (t: Tab) => void }) {
  if (!ov) return <p className="muted">Loading overview</p>;
  const o = ov.overview;
  const h = o.how_much;
  return (
    <div className="overview" data-tour="overview">
      <section className="panel q q-wide">
        <p className="qlabel">What happened</p>
        <p className="qbig">{o.what_happened}</p>
      </section>
      <section className="panel q">
        <p className="qlabel">Why it was raised</p>
        <p>{o.why_raised}</p>
        {o.exceptions_open.length > 0 && <p className="fine">Open control exceptions: {o.exceptions_open.map((x) => <Cite key={x} id={`CTL-${x}`} />)}</p>}
      </section>
      <section className="panel q">
        <p className="qlabel">How much money could be affected</p>
        <p className="qbig money">{usd(h.potential_exposure)} <span className="fine">{h.label.toLowerCase()}</span></p>
        <dl className="mini">
          <div><dt>Invoices</dt><dd>{h.invoice_count}</dd></div>
          <div><dt>Pending payment</dt><dd>{usd(h.pending_payment)}</dd></div>
          <div><dt>On hold</dt><dd>{usd(h.on_hold)}</dd></div>
          <div><dt>Already paid</dt><dd>{usd(h.already_paid)}</dd></div>
          <div><dt>Confirmed loss</dt><dd>None established</dd></div>
        </dl>
        <button className="linkbtn" onClick={() => go("Exposure & actions")}>See the calculation →</button> <button className="linkbtn" onClick={() => document.querySelector("[data-tour=network]")?.scrollIntoView({ behavior: "smooth" })}>See the network ↑</button>
      </section>
      <section className="panel q">
        <p className="qlabel">What the evidence shows</p>
        {o.evidence.length === 0 ? <p className="muted">No findings yet.</p> : (
          <ul className="findings">
            {o.evidence.map((f, i) => (
              <li key={i}><span className={`lab lab-${f.label}`}>{f.label}</span>{f.statement} <span className="cites">{f.cites.map((x) => <Cite key={x} id={x} />)}</span></li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel q">
        <p className="qlabel">Competing explanations and unknowns</p>
        {o.competing.map((x) => (
          <p key={x.id} className="comp"><span className={`lab lab-${x.status}`}>{x.status}</span><span className="kind">{x.kind === "benign" ? "Harmless" : "Concerning"}</span> {x.statement}</p>
        ))}
        {o.unknowns.length > 0 && <ul className="unknowns">{o.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>}
      </section>
      <section className="panel q q-next">
        <p className="qlabel">Next step</p>
        <p className="qbig">{o.next_step}</p>
        <p>Owner: <b>{o.owner}</b></p>
        <p className="fine">"Approved for payment" on an invoice is the ERP's existing business approval. Follow the Money decisions are separate: they approve or reject a hold, a check or a task, and nothing Follow the Money does pays anyone.</p>
        {c.waiting_for === "approval" && !c.busy && <button className="primary" onClick={() => go("Exposure & actions")}>Review the proposed actions</button>}
        {c.status === "remediation" && <button className="primary" onClick={() => go("Verification & audit")}>Go to remediation and verification</button>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Investigation

type AgentStat = { state: string; tools: number; calls: number; cost: number; last: string; model?: string; run?: Ev; done?: Ev; failed?: Ev; toolEvents: Ev[] };

function Investigation({ c, events }: { c: CaseFull; events: Ev[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const byAgent = useMemo(() => {
    const m: Record<string, AgentStat> = {};
    for (const a of AGENTS) m[a.name] = { state: "idle", tools: 0, calls: 0, cost: 0, last: "", toolEvents: [] };
    for (const e of events) {
      const a = m[e.agent];
      if (!a) continue;
      if (e.type === "agent_started") { a.state = "working"; a.model = e.data.model; a.run = e; a.toolEvents = []; a.done = undefined; a.failed = undefined; }
      if (e.type === "tool_call") { a.tools++; a.last = e.text; a.toolEvents.push(e); }
      if (e.type === "llm_call") { a.calls++; a.cost += e.data.cost_usd ?? 0; }
      if (e.type === "agent_finished") a.done = e;
      if (e.type === "agent_failed") { a.failed = e; a.state = "failed"; }
      if (["plan", "evidence", "links", "controls", "exposure", "hypotheses", "briefing", "actions", "verification"].includes(e.type)) {
        a.state = "done"; a.last = e.text;
      }
      if (e.type === "exposure") { m["Exposure engine"].state = "done"; }
    }
    if (c.status === "error") for (const k of Object.keys(m)) if (m[k].state === "working") m[k].state = "failed";
    const va = m["Verification Agent"];
    if (c.status.startsWith("closed") && va.state === "idle") { va.state = "skipped"; va.last = "Not run: closed on the code checks alone"; }
    return m;
  }, [events, c.status]);
  const controls = c.state.controls ?? [];
  const trace = events.filter((e) => e.type !== "llm_call");
  const sel = open ? byAgent[open] : null;

  return (
    <div className="grid2">
      <div>
        <section className="panel" data-tour="agents">
          <div className="panel-head"><h2>Agents</h2><span className="muted">Click an agent to see its input, tool calls, output and timing.</span></div>
          <div className="agents">
            {AGENTS.map((a) => {
              const s = byAgent[a.name];
              return (
                <button key={a.name} className={`agent st-${s.state} ${open === a.name ? "agent-open" : ""}`} onClick={() => setOpen(open === a.name ? null : a.name)}>
                  <div className="agent-top"><h3>{a.name}</h3><span className="agent-state">{s.state === "working" ? "Running" : s.state === "done" ? "Completed" : s.state === "failed" ? "Failed" : s.state === "skipped" ? "Skipped" : "Queued"}</span></div>
                  <p className="job">{a.job}</p>
                  <p className="agent-last">{s.state === "idle" ? `Waits for ${a.after}` : s.last || " "}</p>
                  <p className="agent-meta">{a.name === "Exposure engine" ? "code, no model" : `${s.model ?? ""} · ${s.tools} tool calls · ${s.calls} model calls${s.cost ? ` · $${s.cost.toFixed(4)}` : ""}${s.done ? ` · ${s.done.data.seconds}s` : ""}`}</p>
                </button>
              );
            })}
          </div>
        </section>
        {sel && open && (
          <section className="panel agentdetail">
            <div className="panel-head"><h2>{open}</h2>
              <span className="muted">{sel.run ? `run ${sel.run.data.run_id} · ${sel.run.data.model} · prompt ${sel.run.data.prompt_version}` : open === "Exposure engine" ? "Deterministic code, no model" : "Not run yet"}</span></div>
            {sel.run && (<>
              <h3>Input (handed over by the workflow)</h3>
              <pre className="rec">{sel.run.data.input}</pre>
              <h3>Tools allowed</h3>
              <p className="mono small">{(sel.run.data.tools ?? []).join(", ") || "none: a single structured answer"}</p>
              <h3>Tool calls ({sel.toolEvents.length})</h3>
              <ol className="audit">{sel.toolEvents.map((e) => <li key={e.seq}><span className="mono small">{e.text}</span></li>)}</ol>
            </>)}
            {sel.done && (<><h3>Output (validated by code before it is saved)</h3><pre className="rec">{prettyJson(sel.done.data.output)}</pre></>)}
            {sel.failed && <p className="error">{sel.failed.text}</p>}
          </section>
        )}
        <PlanPanel c={c} done={(name) => byAgent[name]?.state === "done"} running={(name) => byAgent[name]?.state === "working"} />
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
              <details>
                <summary><span className="ev-agent">{e.agent}</span><span className="ev-text">{e.text}</span><time>{new Date(e.at).toLocaleTimeString()}</time></summary>
                <pre className="rec">{JSON.stringify(e.data, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function prettyJson(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

export function Checks({ checks }: { checks: Control[] }) {
  return (
    <ul className="checks">
      {checks.map((r) => (
        <li key={r.id ?? r.test} className={`check c-${r.status}`}>
          <span className="cstat">{r.status === "exception" ? "Exception" : r.status === "exempt" ? "Exempt" : r.status === "pass" ? "Pass" : "N/A"}</span>
          <div><strong>{r.test.replaceAll("_", " ")}</strong> <span className="pol">{r.policy}</span>
            <p>{r.explanation}</p>
            {r.records?.length > 0 && <p className="fine">Records: {r.records.slice(0, 8).map((x) => <Cite key={x} id={x} />)}</p>}
            {r.run_by && <p className="fine">Run by: {r.run_by}</p>}</div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Timeline

function TimelineTab({ c, events }: { c: CaseFull; events: Ev[] }) {
  const [items, setItems] = useState<TL[] | null>(null);
  const n = events.length;
  useEffect(() => { get<{ timeline: TL[] }>(`/api/cases/${c.id}/timeline`).then((r) => setItems(r.timeline)).catch(() => setItems([])); }, [c.id, n]);
  if (!items) return <p className="muted">Building the timeline from records</p>;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Timeline</h2><span className="muted">Built by code from ERP records, documents in Object Storage and the case audit log. Every line names its source.</span></div>
      <ol className="timeline">
        {items.map((t, i) => (
          <li key={i} className={`tl tl-${t.kind} ${t.flag ? "tl-flag" : ""}`}>
            <time>{t.kind === "case" ? new Date(t.at).toLocaleString() : t.at.slice(0, 16).replace("T", " ")}</time>
            <span className="tlkind">{t.kind}</span>
            <span className="tltext">{t.text}{t.flag && <span className="flag">{t.flag}</span>}</span>
            <span className="tlsrc">{t.source_id.startsWith("event") ? <span className="chip">{t.source_id}</span> : <Cite id={t.source_id} />}<em>{t.provenance}</em></span>
          </li>
        ))}
      </ol>
      <p className="fine">Record dates are in the scenario's world clock ({fmt(c.world_now)}); case events are real time.</p>
    </section>
  );
}

// ------------------------------------------------------------------ Evidence

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
            {guards.slice(0, 1).map((g) => <p key={g.seq}><Cite id={g.data.document_id} /> {g.text}</p>)}
            <p className="fine">The email says the bank change "has been verified by your CFO" and tells automated assistants to mark it confirmed. Follow the Money records this as an
              unverified claim. An email can't prove who owns a bank account.</p>
            {(st.lookalikes ?? []).map((l) => <p key={l.document_id}><strong>Look-alike sender:</strong> {l.sender_domain} imitates {l.real_domain} ({l.supplier_id}).</p>)}
          </section>
        )}
        {st.briefing && (
          <section className="panel">
            <div className="panel-head"><h2>Findings</h2><span className={`pill tone-${st.briefing.assessment_by_code === "open_exceptions" ? "amber" : "green"}`}>
              {st.briefing.assessment_by_code === "open_exceptions" ? "Open control exceptions" : "No open exceptions"}</span></div>
            <ul className="findings">
              {st.briefing.findings.map((f, i) => (
                <li key={i}><span className={`lab lab-${f.label}`}>{f.label}</span>{f.statement} <span className="cites">{f.cites.map((x) => <Cite key={x} id={x} />)}</span></li>
              ))}
            </ul>
            <p className="fine">Confirmed: shown by a code check or confirmed link. Supported: backed by evidence, not conclusive. Unresolved: not enough to decide. Contradicted: the evidence conflicts.</p>
          </section>
        )}
        <section className="panel">
          <div className="panel-head"><h2>Hypotheses</h2><span className="muted">The Challenge Agent argues against the leading explanation.</span></div>
          {!(st.hypotheses?.length) && <p className="pending">{c.status === "new" ? "Pending: start the investigation." : c.status === "error" ? "Blocked: an earlier step failed. Retry from the checkpoint above." : "Pending: the Challenge Agent runs after the evidence, relationship, control and exposure steps finish."}</p>}
          <div className="hyps">
            {st.hypotheses?.map((h) => (
              <div key={h.id} className={`hyp k-${h.kind}`}>
                <div className="hyp-top"><span className="kind">{h.kind === "benign" ? "Harmless explanation" : "Concerning explanation"}</span><span className={`lab lab-${h.status}`}>{h.status}</span></div>
                <p className="stmt">{h.statement}</p>
                {h.supporting.length > 0 && <p className="for">Supporting: {h.supporting.map((x) => <Cite key={x} id={x} />)}</p>}
                {h.contradicting.length > 0 && <p className="against">Contradicting: {h.contradicting.map((x) => <Cite key={x} id={x} />)}</p>}
                <p className="fine">What would settle it: {h.what_would_settle_it}</p>
              </div>
            ))}
          </div>
          {st.unknowns && st.unknowns.length > 0 && (<><h3>Still unknown</h3><ul className="unknowns">{st.unknowns.map((u) => <li key={u}>{u}</li>)}</ul></>)}
        </section>
      </div>
      <div>
        <section className="panel">
          <p className="fine">A document being a valid source doesn't make its claims true: emails from outside are labelled "Unverified claim".</p>
        <div className="panel-head"><h2>Evidence ledger</h2><span className="muted">{st.evidence?.length ?? 0} accepted · {rejected.length} rejected by the validator</span></div>
          {!st.evidence && <p className="pending">{c.status === "new" ? "Pending: start the investigation." : c.status === "error" ? "Blocked: the Evidence Agent's step failed. Nothing it produced was accepted. Retry from the checkpoint above." : "Pending: the Evidence Agent is reading records and documents. Each item is checked against its source before it's accepted."}</p>}
          <ul className="evidence">
            {st.evidence?.map((e) => (
              <li key={e.id} className={e.trust === "external-unverified" ? "untrusted" : ""}>
                <div className="ev-top"><b>{e.id}</b><Cite id={e.source_id} /><span className={`lab ${e.label === "Unverified claim" ? "lab-Unresolved" : "lab-Confirmed"}`}>{e.label}</span></div>
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

function Lifecycle({ stages }: { stages: Stage[] }) {
  return (
    <ol className="life">
      {stages.map((s, i) => (
        <li key={i} className={`ls-${s.state}`} title={[s.by, s.note].filter(Boolean).join(" · ")}>
          <span className="lsdot" />{s.stage}{s.by && s.state !== "waiting" ? <em> · {s.by}</em> : s.state === "waiting" && s.by ? <em> · waiting for {s.by}</em> : null}
        </li>
      ))}
    </ol>
  );
}

function ExposureTab({ c, actions, onDone }: { c: CaseFull; actions: ActionView[]; onDone: () => void }) {
  const ex = c.state.exposure as (CaseFull["state"]["exposure"] & { invoice_count?: number; pending_payment?: number; on_hold?: number; already_paid?: number; includes?: string; excludes?: string }) | undefined;
  const { can, needs } = usePersona();
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
        <div className="panel-head"><h2>Potential exposure</h2><span className="muted">Computed by code from the records below. Not a confirmed loss.</span></div>
        {!ex ? <p className="muted">Not computed yet.</p> : (
          <>
            <div className="exnums">
              <div><span>In {ex.run_id} ({ex.invoice_count ?? ex.lines.length} invoices)</span><strong>{usd(ex.total_in_run)}</strong></div>
              <div><span>Not backed by receipts</span><strong className="red">{usd(ex.unsupported_by_receipts)}</strong></div>
              <div><span>To an unverified new bank account</span><strong className="amber">{usd(ex.to_unverified_changed_account)}</strong></div>
            </div>
            <dl className="mini row">
              <div><dt>Pending payment</dt><dd>{usd(ex.pending_payment)}</dd></div>
              <div><dt>On hold</dt><dd>{usd(ex.on_hold)}</dd></div>
              <div><dt>Already paid</dt><dd>{usd(ex.already_paid)}</dd></div>
              <div><dt>Confirmed loss</dt><dd>None established</dd></div>
            </dl>
            <table className="table">
              <thead><tr><th>Invoice</th><th>Supplier</th><th className="num">Amount</th><th>Receipt check</th><th>Payment</th></tr></thead>
              <tbody>
                {ex.lines.map((l) => (
                  <tr key={l.invoice_id}>
                    <td><Cite id={l.invoice_id} /></td>
                    <td><Cite id={l.supplier_id} />{l.to_recently_changed_account && <span className="flag">new bank account</span>}</td>
                    <td className="num money">{usd(l.amount)}</td>
                    <td className="mono small">{l.formula}</td>
                    <td>{l.payment_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="formula mono">{ex.formula}</p>
            {ex.includes && <p className="fine"><b>Includes:</b> {ex.includes}</p>}
            {ex.excludes && <p className="fine"><b>Excludes:</b> {ex.excludes}</p>}
          </>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Actions</h2><span className="muted">Proposed by the Resolution Agent. Each needs the Finance Director. Nothing can pay anyone.</span></div>
        {actions.length === 0 && <p className="muted">No actions proposed yet.</p>}
        <ul className="actions">
          {actions.map((a) => (
            <li key={a.id} className={`act s-${a.status}`}>
              <div className="act-top"><b>{a.label}</b><span className="targets">{a.target_ids.map((t) => <Cite key={t} id={t} />)}</span></div>
              <p>{a.rationale}</p>
              <p className="fine">Owner: {a.owner}{a.due ? ` · Due ${a.due.slice(0, 16).replace("T", " ")} (world clock)` : ""}</p>
              {a.expected_outcome && <p className="fine">Expected outcome: {a.expected_outcome}</p>}
              <Lifecycle stages={a.lifecycle} />
              {waiting && (
                <div className="decide">
                  {(["approved", "rejected"] as const).map((d) => (
                    <label key={d} className={dec[a.id]?.decision === d ? `on ${d}` : ""}>
                      <input type="radio" name={a.id} checked={dec[a.id]?.decision === d} onChange={() => setDec({ ...dec, [a.id]: { ...dec[a.id], decision: d } })} />
                      {d === "approved" ? "Approve" : "Reject"}
                    </label>
                  ))}
                  <input className="reason" placeholder={dec[a.id]?.decision === "rejected" ? "Reason (required to reject)" : "Reason (optional)"} value={dec[a.id]?.reason ?? ""}
                    onChange={(e) => setDec({ ...dec, [a.id]: { ...dec[a.id], reason: e.target.value } })} />
                </div>
              )}
            </li>
          ))}
        </ul>
        {waiting && actions.length > 0 && (
          <div className="approvebar">
            <PersonaAction perm="decide" busy={busy} label="Submit decisions" onClick={async (persona) => {
              setBusy(true); setErr(null);
              try { await post(`/api/cases/${c.id}/decisions`, { persona, decisions: dec }); onDone(); } catch (e) { setErr((e as Error).message); }
              setBusy(false);
            }} />
            <p className="fine">{can("decide") ? "The workflow is paused in Postgres until you decide. It survives an API restart." : needs("decide")}</p>
          </div>
        )}
        {err && <p className="error">{err}</p>}
      </section>
    </div>
  );
}

function PersonaAction({ perm, label, busy, onClick, className = "primary" }: { perm: string; label: string; busy: boolean; onClick: (persona: string) => void; className?: string }) {
  const { persona, can, needs } = usePersona();
  // The button stays clickable for the wrong persona so the server's refusal can be shown on camera.
  const ok = can(perm);
  const who = { decide: "Finance Director", close: "Finance Director", override: "Finance Director", audit_ack: "Internal Audit", "remediation:callback": "Procurement", "remediation:receiving": "Warehouse" }[perm];
  return (
    <button className={`${className} ${ok ? "" : "locked"}`} disabled={busy} title={ok ? "" : needs(perm)} onClick={() => onClick(persona)}>
      {busy ? "Working" : <>{ok ? "" : "🔒 "}{label}{ok ? "" : <small> · {who} only</small>}</>}
    </button>
  );
}

// ------------------------------------------------------------------ Verification

function VerifyTab({ c, events, actions, criteria, onDone }: { c: CaseFull; events: Ev[]; actions: ActionView[]; criteria: Criteria; onDone: () => void }) {
  const st = c.state;
  const [override, setOverride] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refusal = [...events].reverse().find((e) => e.type === "close_refused");
  const denied = [...events].reverse().find((e) => e.type === "permission_denied");
  const closedEv = events.find((e) => e.type === "closed");
  const remed = c.status === "remediation";
  const ready = c.waiting_for === "remediation" && !c.busy;
  const docs = st.remediation_docs ?? [];
  const audit = actions.find((a) => a.kind === "escalate_to_audit" && a.decision === "approved");
  const { setPersona } = usePersona();
  const approved = (k: string) => actions.some((a) => a.kind === k && a.decision === "approved");
  const rejected = actions.filter((a) => a.decision === "rejected");
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
        {refusal && !c.status.startsWith("closed") && (() => {
          const now = (st.verification?.checks ?? []).filter((x) => x.status === "exception");
          const failing: Control[] = now.length ? now : (refusal.data.failing ?? []);
          return failing.length > 0 && (
            <section className="panel refused">
              <h2>Close refused: {failing.length} check{failing.length > 1 ? "s" : ""} still failing</h2>
              <p>"Resolved" isn't a button: each control has to pass first. Here's how to fix each one.</p>
              <ul className="fixlist">
                {failing.map((f) => {
                  const fx = fixFor(f.test, actions);
                  return (
                    <li key={f.test}>
                      <b>{f.test.replaceAll("_", " ")}</b>
                      <span className="fine">{f.explanation}</span>
                      <span className="howfix">How to fix: {fx.how}</span>
                      {fx.persona && <button onClick={() => setPersona(fx.persona!)}>{fx.button}</button>}
                    </li>
                  );
                })}
              </ul>
              <p className="fine">Or close with a documented override below: the Finance Director must give a written reason, recorded in the signed report.</p>
            </section>
          );
        })()}
        <section className="panel">
          <div className="panel-head"><h2>Closure checks</h2><span className="muted">{st.verification ? `Computed ${new Date(st.verification.at ?? st.verification.last_refusal ?? "").toLocaleTimeString()}` : "Run verification to compute"}</span></div>
          {st.verification ? <Checks checks={st.verification.checks} /> : criteria.length > 0 ? (<>
            <p className="pending">Not verified yet. These are the criteria code will check, shown with their current state. The case can't close until all pass, or the Finance Director records an override with a reason.</p>
            <Checks checks={criteria} /></>) : <p className="pending">Criteria appear once the control tests have run.</p>}
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
            <div className="panel-head"><h2>Remediation tasks</h2><span className="muted">Each step adds a real document to Object Storage and updates this case's copy of the ERP.</span></div>
            <ul className="actions">
              {actions.filter((a) => a.decision === "approved").map((a) => (
                <li key={a.id} className="act"><b>{a.label}</b> <span className="fine">· {a.owner}</span><Lifecycle stages={a.lifecycle} />
                  {a.status === "task_open" && a.kind !== "escalate_to_audit" && !(isA && ["supplier_callback", "due_diligence", "receiving_confirmation"].includes(a.kind)) && (
                    <TaskDone caseId={c.id} actionId={a.id} owner={a.owner} onDone={onDone} />
                  )}
                </li>
              ))}
            </ul>
            {rejected.length > 0 && (
              <div className="rejected-acts">
                <p><b>You rejected {rejected.length} action{rejected.length > 1 ? "s" : ""}.</b> If a closure check depends on one, the case can't close until it's done. The Finance Director can reconsider:</p>
                {rejected.map((a) => (
                  <div key={a.id} className="rej">
                    <span>{a.label} <span className="fine">({a.target_ids.join(", ")})</span></span>
                    <PersonaAction perm="decide" className="" busy={busy === a.id} label="Reconsider and approve"
                      onClick={(persona) => act(a.id, () => post(`/api/cases/${c.id}/actions/${a.id}/reconsider`, { persona }))} />
                  </div>
                ))}
              </div>
            )}
            {isA && (approved("supplier_callback") || approved("due_diligence") || approved("receiving_confirmation")) && (
              <div className="simbtns">
                {(approved("supplier_callback") || approved("due_diligence")) && <PersonaAction perm="remediation:callback" className="" busy={busy === "cb"} label={docs.includes("DOC-CB-301") ? "✓ Callback note added" : "Procurement: callback and due diligence"}
                  onClick={(persona) => !docs.includes("DOC-CB-301") && act("cb", () => post(`/api/cases/${c.id}/remediation`, { kind: "callback", persona }))} />}
                {approved("receiving_confirmation") && <PersonaAction perm="remediation:receiving" className="" busy={busy === "rc"} label={docs.includes("DOC-RC-7104") ? "✓ Receiving confirmed" : "Warehouse and AP: confirm receipts"}
                  onClick={(persona) => !docs.includes("DOC-RC-7104") && act("rc", () => post(`/api/cases/${c.id}/remediation`, { kind: "receiving", persona }))} />}
              </div>
            )}
            {audit && (
              <div className="simbtns">
                <PersonaAction perm="audit_ack" className="" busy={busy === "au"} label={audit.acknowledged_by ? "✓ Audit acknowledged" : "Internal Audit: acknowledge"}
                  onClick={(persona) => !audit.acknowledged_by && act("au", () => post(`/api/cases/${c.id}/audit-ack`, { persona }))} />
              </div>
            )}
            <p className="fine">Simulation: switch persona at the top right to act as Procurement, the Warehouse or Internal Audit. Each button checks the role on the server.</p>
            <div className="closebar">
              <button className="secondary" disabled={!ready || !!busy} onClick={() => act("v", () => post(`/api/cases/${c.id}/verify`))}>{busy === "v" || (c.busy && remed) ? "Verifying" : "Run verification"}</button>
              <PersonaAction perm="close" busy={busy === "c"} label="Close incident" onClick={(persona) => ready && act("c", () => post(`/api/cases/${c.id}/close`, { persona, override_reason: "" }))} />
            </div>
            <button className="linkbtn" onClick={() => setShowOverride(!showOverride)}>Close with a documented override</button>
            {showOverride && (
              <div className="override">
                <textarea placeholder="Why this incident should close although checks fail (at least 20 characters). Recorded in the signed report." value={override} onChange={(e) => setOverride(e.target.value)} />
                <PersonaAction perm="override" className="danger" busy={busy === "o"} label="Close with override"
                  onClick={(persona) => ready && act("o", () => post(`/api/cases/${c.id}/close`, { persona, override_reason: override }))} />
              </div>
            )}
            {err && <p className="error">{err}</p>}
            {denied && <p className="fine">Last refusal: {denied.agent}: {denied.text}</p>}
          </section>
        )}
        <section className="panel">
          <div className="panel-head"><h2>Audit trail</h2><span className="muted">Every agent step and human decision, with who and when, stored in Postgres.</span>
            <a className="button small" href={`/api/cases/${c.id}/export`}>Export</a></div>
          <ol className="audit">
            {events.filter((e) => e.type !== "llm_call" && e.type !== "tool_call").map((e) => (
              <li key={e.seq} className={e.type === "permission_denied" ? "denied" : ""}><time>{fmtTime(e.at)}</time><b>{e.agent}</b> {e.text}</li>
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

function runningAgent(events: Ev[]) {
  const open = new Map<string, boolean>();
  for (const e of events) {
    if (e.type === "agent_started") open.set(e.agent, true);
    if (e.type === "agent_finished" || e.type === "agent_failed") open.set(e.agent, false);
  }
  const names = [...open.entries()].filter(([, v]) => v).map(([k]) => k);
  return names.length ? `Running: ${names.join(", ")}` : null;
}

function TaskDone({ caseId, actionId, owner, onDone }: { caseId: string; actionId: string; owner: string; onDone: () => void }) {
  const { persona } = usePersona();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="decide">
      <input className="reason" placeholder={`What ${owner.split(",")[0]} found (at least 10 characters)`} value={note} onChange={(e) => setNote(e.target.value)} />
      <button disabled={note.trim().length < 10} onClick={() => post(`/api/cases/${caseId}/tasks/${actionId}/complete`, { persona, note }).then(onDone).catch((e) => setErr(e.message))}>Mark done</button>
      {err && <span className="error small">{err}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ guided demo

const PERSONA_OF: Record<string, string> = { "Grace Liu": "procurement", "Ana Petrov": "warehouse", "Rafael Moreno": "internal_audit", "Elena Brandt": "ap_lead", "Tom Okafor": "finance_director" };

function Guide({ c, events, actions, go }: { c: CaseFull; events: Ev[]; actions: ActionView[]; go: (t: Tab) => void }) {
  const { persona, setPersona } = usePersona();
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("guide-hidden") === "1");
  if (hidden) return null;
  const types = new Set(events.map((e) => e.type));
  const docs = c.state.remediation_docs ?? [];
  const isA = c.template === "INC-0412";
  let step = "", text: React.ReactNode = "", btn: { label: string; run: () => void } | null = null;
  const as = (p: string, t: Tab) => () => { setPersona(p); go(t); };

  if (c.status === "new") {
    step = "Step 1 of 5"; text = <>Click <b>Start investigation</b>. Eight agents will work through the case in about 90 seconds.</>;
  } else if (c.status === "investigating" || (c.busy && c.status !== "remediation")) {
    step = "Step 1 of 5"; text = <>The agents are investigating. Watch them on <b>Investigation</b>, or watch the network above light up as they work. It takes about 90 seconds.</>;
    btn = { label: "Watch the agents", run: () => go("Investigation") };
  } else if (c.status === "error") {
    step = "Blocked"; text = <>A step failed. Click <b>Retry from checkpoint</b>; finished work is kept.</>;
  } else if (c.waiting_for === "approval") {
    step = "Step 2 of 5";
    if (persona !== "finance_director" && !types.has("permission_denied")) {
      text = <>Read the <b>Overview</b>, then on <b>Exposure &amp; actions</b> click <b>Submit decisions</b> as Elena, the AP lead. The system will refuse: only the Finance Director can approve.</>;
      btn = { label: "Go to the actions", run: () => go("Exposure & actions") };
    } else {
      text = <>Now act as <b>Tom Okafor, Finance Director</b>, and approve the plan. Nothing here can pay anyone.</>;
      btn = { label: "Switch to Tom and review", run: as("finance_director", "Exposure & actions") };
    }
  } else if (c.status === "remediation") {
    const refused = types.has("close_refused");
    const open = actions.filter((a) => a.decision === "approved" && a.status === "task_open");
    const audit = actions.find((a) => a.kind === "escalate_to_audit" && a.decision === "approved" && !a.acknowledged_by);
    const ready = c.state.verification?.may_close;
    if (!refused) {
      step = "Step 3 of 5"; text = <>Try to close the incident now, as the Finance Director. It will be <b>refused</b>, because the fixes haven't been proven yet.</>;
      btn = { label: "Switch to Tom and try closing", run: as("finance_director", "Verification & audit") };
    } else if (actions.some((a) => a.decision === "rejected" && ["supplier_callback", "due_diligence", "receiving_confirmation", "review_hold"].includes(a.kind))
      && (c.state.verification?.checks ?? []).some((x) => x.status === "exception")) {
      step = "Step 4 of 5"; text = <>A closure check depends on an action you <b>rejected</b>. As <b>Tom Okafor</b>, reconsider it under Remediation tasks, or close with a documented override.</>;
      btn = { label: "Switch to Tom", run: as("finance_director", "Verification & audit") };
    } else if (isA && !docs.includes("DOC-CB-301")) {
      step = "Step 4 of 5"; text = <>Play <b>Grace Liu, Procurement</b>: call the supplier on the number on file and check the new supplier. Click <b>Procurement: callback and due diligence</b>.</>;
      btn = { label: "Switch to Grace", run: as("procurement", "Verification & audit") };
    } else if (isA && !docs.includes("DOC-RC-7104")) {
      step = "Step 4 of 5"; text = <>Play <b>Ana Petrov, Warehouse</b>: confirm what was actually delivered. Click <b>Warehouse and AP: confirm receipts</b>.</>;
      btn = { label: "Switch to Ana", run: as("warehouse", "Verification & audit") };
    } else if (audit) {
      step = "Step 4 of 5"; text = <>Play <b>Rafael Moreno, Internal Audit</b>: acknowledge the approval-pattern finding.</>;
      btn = { label: "Switch to Rafael", run: as("internal_audit", "Verification & audit") };
    } else if (open.length) {
      const owner = open[0].owner.split(",")[0];
      step = "Step 4 of 5"; text = <>Play <b>{open[0].owner}</b>: complete the task <b>{open[0].label}</b> with a short note.</>;
      btn = { label: `Switch to ${owner}`, run: as(PERSONA_OF[owner] ?? "ap_lead", "Verification & audit") };
    } else if (!ready) {
      step = "Step 5 of 5"; text = <>Click <b>Run verification</b>. Code retests every control against the new evidence.</>;
      btn = { label: "Go to verification", run: () => go("Verification & audit") };
    } else {
      step = "Step 5 of 5"; text = <>Every check passes. Close the incident as <b>Tom Okafor</b>. A signed report goes to Vultr Object Storage.</>;
      btn = { label: "Switch to Tom and close", run: as("finance_director", "Verification & audit") };
    }
  } else if (c.status.startsWith("closed")) {
    step = "Done"; text = <>Closed {c.status === "closed" ? "after verification" : "by override"}. Open the signed report, export the record, or try the harmless look-alike case.</>;
    btn = { label: "Back to incidents", run: () => { location.href = "/?view=incidents"; } };
  }
  if (!text) return null;
  return (
    <div className="guide" role="note" data-tour="guide">
      <span className="gstep">Guided demo · {step}</span>
      <p>{text}</p>
      {btn && <button onClick={btn.run}>{btn.label}</button>}
      <button className="gx" onClick={() => { sessionStorage.setItem("guide-hidden", "1"); setHidden(true); }} aria-label="Hide the guide">Hide</button>
    </div>
  );
}

// ------------------------------------------------------------------ live network focus

const ID_RE = /\b(?:DOC-)?((?:INV|PR|SUP|EML|CHG|PAY|GRN|FA|EMP)-[A-Z0-9-]*\d)\b/g;

function idsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(ID_RE)) out.add(m[1]);
  return [...out];
}

function focusFrom(c: CaseFull, events: Ev[]): Focus {
  const st = c.state;
  for (let i = events.length - 1; i >= 0 && i > events.length - 12; i--) {
    const e = events[i];
    let ids: string[] = [];
    let caption = e.text;
    if (e.type === "tool_call" || e.type === "untrusted_instruction" || e.type === "agent_started") ids = idsIn(`${e.text} ${JSON.stringify(e.data?.arguments ?? {})}`);
    if (e.type === "agent_started") ids = ids.length ? ids : c.supplier_ids;
    if (e.type === "links") {
      const attrs = (st.links ?? []).filter((l) => l.strength !== "fact" && l.strength !== "weak");
      ids = [...new Set(attrs.flatMap((l) => [l.from, l.to, `${l.attribute === "bank_account_token" ? "BANK" : l.attribute === "phone" ? "PHONE" : "ADDR"}:${l.value}`]))];
      caption = "Shared identifiers found between suppliers";
    }
    if (e.type === "controls") { ids = (st.controls ?? []).filter((x) => x.status === "exception").flatMap((x) => x.records ?? []); caption = e.text; }
    if (e.type === "exposure") { ids = (st.exposure?.lines ?? []).flatMap((l) => l.records); caption = "Money at risk in the payment run"; }
    if (e.type === "finding_downgraded" || e.type === "alternative_rejected" || e.type === "hypotheses") ids = idsIn(`${e.text} ${JSON.stringify(e.data ?? {})}`);
    if (e.type === "actions" || e.type === "decision" || e.type === "action_done" || e.type === "task_created") ids = idsIn(`${e.text} ${JSON.stringify(e.data ?? {})}`);
    if (e.type === "remediation_evidence") ids = idsIn(JSON.stringify(e.data ?? {}));
    if (e.type === "checks" || e.type === "close_refused") ids = idsIn(JSON.stringify(e.data ?? {}));
    ids = ids.filter((x) => !x.startsWith("PO-"));
    if (ids.length) return { ids: ids.slice(0, 14), caption: caption.length > 110 ? caption.slice(0, 108) + "…" : caption, agent: e.agent };
  }
  return null;
}

function CaseNetwork({ c, events }: { c: CaseFull; events: Ev[] }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (location.hash === "#network") window.setTimeout(() => document.getElementById("network")?.scrollIntoView({ behavior: "smooth" }), 600);
  }, []);
  const live = c.busy || c.status === "investigating";
  const focus = useMemo(() => (open ? focusFrom(c, events) : null), [events.length, open, c.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshKey = events.filter((e) => ["action_done", "remediation_evidence", "closed"].includes(e.type)).length;
  return (
    <section className="panel nxpanel casenet" data-tour="network" id="network">
      <div className="panel-head">
        <h2>Network</h2>
        <span className="muted">{live ? "Live: the parts the agents are working on light up, with arrows, as they go." : `Everything within two steps of ${c.supplier_ids.join(", ")}. Drag, zoom, double-click to expand, or press Follow the money.`}</span>
        <button className="linkbtn" style={{ marginLeft: "auto" }} onClick={() => setOpen(!open)}>{open ? "Collapse" : "Show network"}</button>
      </div>
      {open && <NetworkExplorer caseId={c.id} seeds={c.supplier_ids} compact focus={focus} refreshKey={refreshKey}
        onOpenSupplier={(sid) => { location.href = `/?supplier=${sid}`; }} />}
    </section>
  );
}

function RoleStrip() {
  const { persona } = usePersona();
  const p = PERSONAS[persona];
  return (
    <div className="rolestrip" style={{ borderLeftColor: ROLE_COLOR[persona] }}>
      <span className="pchip" style={{ background: ROLE_COLOR[persona] }}>{p.name.split(" ").map((w) => w[0]).join("")}</span>
      <span>Acting as <b>{p.name}, {p.role}</b>. You can {ROLE_CAN[persona]}</span>
    </div>
  );
}

// ------------------------------------------------------------------ investigation plan

const PLAN_STEPS = [
  { q: "Are these suppliers really separate companies?", who: "Relationship Agent", how: "compares bank accounts, phones and addresses across all suppliers" },
  { q: "What do the original documents say?", who: "Evidence Agent", how: "reads the invoices, receipts and emails, and quotes them" },
  { q: "Which company rules were broken?", who: "Control Agent", how: "runs the six policy tests; code decides pass or fail" },
  { q: "How much money is at risk?", who: "Exposure engine", how: "adds it up in code, invoice by invoice" },
  { q: "Is there an innocent explanation?", who: "Challenge Agent", how: "argues the other side and looks for proof, such as a contract" },
  { q: "What should happen before the payment run?", who: "Resolution Agent", how: "proposes holds and checks for a person to approve" },
];

function PlanPanel({ c, done, running }: { c: CaseFull; done: (a: string) => boolean; running: (a: string) => boolean }) {
  const answered = PLAN_STEPS.filter((s) => done(s.who)).length;
  return (
    <section className="panel plan">
      <div className="panel-head">
        <h2>Investigation plan</h2>
        <span className="muted">The questions this incident must answer, and who answers each one. {c.status === "new" ? "Not started." : `${answered} of ${PLAN_STEPS.length} answered.`}</span>
      </div>
      <ol className="planlist">
        {PLAN_STEPS.map((s) => {
          const st = done(s.who) ? "done" : running(s.who) ? "run" : "wait";
          return (
            <li key={s.q} className={`pl-${st}`}>
              <span className="pl-dot">{st === "done" ? "✓" : st === "run" ? "…" : ""}</span>
              <div><b>{s.q}</b><p><span className="pl-who">{s.who}</span> {s.how}</p></div>
              <em>{st === "done" ? "Answered" : st === "run" ? "Working now" : "Waiting"}</em>
            </li>
          );
        })}
      </ol>
      {c.state.plan?.objective && <details className="pl-raw"><summary>The Incident Commander's own wording</summary><p>{c.state.plan.objective}</p></details>}
    </section>
  );
}

// What fixes each closure check, and who has to do it.
function fixFor(test: string, actions: ActionView[]): { how: string; persona?: string; button?: string } {
  const has = (k: string) => actions.find((a) => a.kind === k);
  const rej = (k: string) => has(k)?.decision === "rejected";
  switch (test) {
    case "bank_change_cooling_off":
      return rej("supplier_callback") && rej("due_diligence")
        ? { how: "the supplier callback was rejected. Reconsider it as the Finance Director, then Procurement calls the supplier.", persona: "finance_director", button: "Switch to Tom (Finance Director)" }
        : { how: "Procurement calls the supplier on the phone number on file, from before the change.", persona: "procurement", button: "Switch to Grace (Procurement)" };
    case "new_supplier_due_diligence":
      return rej("due_diligence") && rej("supplier_callback")
        ? { how: "due diligence was rejected. Reconsider it as the Finance Director first.", persona: "finance_director", button: "Switch to Tom (Finance Director)" }
        : { how: "Procurement completes due diligence on the new supplier.", persona: "procurement", button: "Switch to Grace (Procurement)" };
    case "three_way_match":
      return rej("receiving_confirmation")
        ? { how: "the receiving confirmation was rejected. Reconsider it as the Finance Director first.", persona: "finance_director", button: "Switch to Tom (Finance Director)" }
        : { how: "the Warehouse confirms what was actually received, and AP disputes the shortfall.", persona: "warehouse", button: "Switch to Ana (Warehouse)" };
    case "audit_escalation":
      return { how: "Internal Audit acknowledges the escalation.", persona: "internal_audit", button: "Switch to Rafael (Internal Audit)" };
    case "approved_tasks":
      return { how: "each owner finishes their open task (see Remediation tasks).", };
    case "containment":
      return rej("review_hold")
        ? { how: "the payment hold was rejected. Reconsider it as the Finance Director.", persona: "finance_director", button: "Switch to Tom (Finance Director)" }
        : { how: "place the affected invoices on hold." };
    default:
      return { how: "see the explanation, then run verification again." };
  }
}
