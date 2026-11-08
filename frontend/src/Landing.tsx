import { useState } from "react";
import { post } from "./api";
import { MoneyMap, useNetwork } from "./MoneyMap";

export async function startDemo(template = "INC-0412") {
  const { id } = await post<{ id: string }>(`/api/cases/${template}/rerun`);
  await post(`/api/cases/${id}/investigate`);
  localStorage.setItem("persona", "ap_lead");
  location.href = `/?case=${id}&guide=1`;
}

export function Mark({ light = false }: { light?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <rect width="32" height="32" rx="8" fill={light ? "#ffffff" : "#0b1d3a"} />
      <path d="M7 22 C12 22 13 10 18 10 S24 16 25 16" fill="none" stroke={light ? "#0b1d3a" : "#7dd3fc"} strokeWidth="3" strokeLinecap="round" />
      <circle cx="25" cy="16" r="3" fill={light ? "#0b1d3a" : "#ffffff"} />
    </svg>
  );
}

function Logo({ light = false }: { light?: boolean }) {
  return (
    <a className={`lp-logo ${light ? "on-dark" : ""}`} href="/">
      <Mark light={light} />
      Follow the Money
    </a>
  );
}

export function Landing() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const net = useNetwork();
  const run = (t: string) => { setBusy(t); setErr(null); startDemo(t).catch((e) => { setErr(e.message); setBusy(null); }); };

  return (
    <div className="lp">
      <section className="fh">
        <div className="fh-glow" aria-hidden="true" />
        <MoneyMap net={net} onPick={(id) => { location.href = `/?case=${id}`; }} />
        <header className="fh-nav">
          <Logo light />
          <nav>
            <a href="#problem">Problem</a>
            <a href="#how">How it works</a>
            <a href="#demo">Demo</a>
            <a href="#trust">Trust</a>
            <a href="#vultr">Vultr</a>
          </nav>
          <a className="fh-signin" href="/?view=incidents">Open the app <span>→</span></a>
        </header>
        <div className="fh-copy">
          <p className="fh-live"><i /> {net ? `Live · ${net.run.id} · ${net.suppliers.length} suppliers · ${net.incidents.length} incidents` : "Loading the payment run"}</p>
          <h1>Follow every dollar before it leaves.</h1>
          <p>AI agents trace each payment back to its supplier, invoice, delivery and bank details, flag what doesn't add up, and wait for a person to approve every action.</p>
          <div className="fh-cta">
            <button className="fh-btn" disabled={!!busy} onClick={() => run("INC-0412")}>{busy ? "Starting the agents…" : "Run the live demo"} <span>→</span></button>
            <span className="fh-note">• No sign-up · runs on Vultr · fictional data</span>
          </div>
          {err && <p className="lp-err">{err}</p>}
        </div>
        <div className="fh-legend">
          <span><i className="lg-run" />Payment run</span>
          <span><i className="lg-flow" />Money due, by size</span>
          <span><i className="lg-risk" />Supplier in an incident</span>
          <span><i className="lg-link" />Shared bank, phone or address</span>
          <span className="fh-hint">Hover a supplier · click a red one</span>
        </div>
      </section>

      <section className="lp-strip">
        <div><b>~90 s</b><span>from alert to a decision-ready briefing</span></div>
        <div><b>$144,000</b><span>potential exposure scoped in the demo, every dollar traced</span></div>
        <div><b>8 roles</b><span>agents plus code checks, each with one job</span></div>
        <div><b>~$0.07</b><span>of AI inference per incident, measured live</span></div>
      </section>

      <section className="lp-sec" id="problem">
        <p className="lp-kicker">The problem</p>
        <h2>An alert tells you something looks wrong. It doesn't tell you what happened.</h2>
        <div className="lp-grid3">
          <div className="lp-card"><span className="lp-ico">🧩</span><h3>Evidence is scattered</h3><p>Invoices, purchase orders, supplier bank details, delivery notes and emails sit in different systems. Each record looks fine on its own.</p></div>
          <div className="lp-card"><span className="lp-ico">⏱️</span><h3>The payment run won't wait</h3><p>Someone has to connect the dots, work out how much is at risk and get four teams moving before money leaves the account.</p></div>
          <div className="lp-card"><span className="lp-ico">✅</span><h3>"Resolved" isn't proof</h3><p>Cases get closed because someone clicked a button, not because anyone checked that the underlying problem was actually fixed.</p></div>
        </div>
      </section>

      <section className="lp-sec alt" id="how">
        <p className="lp-kicker">How it works</p>
        <h2>From alert to verified resolution in four steps</h2>
        <ol className="lp-steps">
          <li><span>1</span><h3>Detect</h3><p>A rule scans the next payment run and flags invoices just under the approval limit from suppliers that look connected.</p><em>Code</em></li>
          <li><span>2</span><h3>Investigate</h3><p>AI agents gather evidence from the original documents, link suppliers, run policy checks and argue for the innocent explanation.</p><em>AI agents</em></li>
          <li><span>3</span><h3>Approve</h3><p>The Finance Director sees the evidence and the dollar exposure, and approves or rejects each proposed action. Nothing pays anyone.</p><em>Human</em></li>
          <li><span>4</span><h3>Verify</h3><p>After the teams act, the controls are retested in code. The case closes only when every check passes.</p><em>Code</em></li>
        </ol>
      </section>

      <section className="lp-sec" id="demo">
        <p className="lp-kicker">Try the demo</p>
        <h2>The Northstar case: three invoices that look unrelated</h2>
        <div className="lp-demo">
          <div>
            <p className="lp-p">A fictional manufacturer's weekly payment run is 33 hours away. Three suppliers each sent an invoice just under the $50,000 approval limit:
              $47,000, $48,000 and $49,000. On their own they pass every check. Follow the Money finds that all three share one bank account, one of them changed its
              bank details 7 days ago after an email from a look-alike domain, and $67,800 was billed for goods never received.</p>
            <ol className="lp-guide">
              <li><b>Start the investigation</b> and watch eight agents work in real time.</li>
              <li><b>Read the Overview:</b> what happened, how much is at risk and who acts next.</li>
              <li><b>Approve the plan as the Finance Director.</b> Try it as the AP lead first: the system refuses.</li>
              <li><b>Try to close the case.</b> It's refused, because the fixes haven't been proven yet.</li>
              <li><b>Play each team</b> (Procurement, Warehouse, Audit), re-run verification and close.</li>
            </ol>
            <div className="lp-cta">
              <button className="lp-btn big" disabled={!!busy} onClick={() => run("INC-0412")}>{busy === "INC-0412" ? "Starting…" : "Start the Northstar demo →"}</button>
              <button className="lp-btn big ghost" disabled={!!busy} onClick={() => run("INC-0413")}>{busy === "INC-0413" ? "Starting…" : "Try the harmless look-alike"}</button>
            </div>
            <p className="lp-note">The look-alike case has three near-limit invoices too, but they're covered by a signed contract. Follow the Money finds it and clears the supplier. It investigates risk; it doesn't accuse.</p>
          </div>
          <Preview compact />
        </div>
      </section>

      <section className="lp-sec alt" id="trust">
        <p className="lp-kicker">Why trust it</p>
        <h2>The AI argues. Code decides. People approve.</h2>
        <div className="lp-grid4">
          <div className="lp-card"><h3>Every claim has a source</h3><p>Each finding links to the invoice, record or email it came from. A quote that isn't in the source is rejected automatically.</p></div>
          <div className="lp-card"><h3>Money is never guessed</h3><p>Exposure, thresholds and matches are calculated in code, with the formula and records shown beside each number.</p></div>
          <div className="lp-card"><h3>It ignores tricks</h3><p>The demo's email claims "verified by your CFO" and tells AI assistants to approve it. Follow the Money flags it and treats it as an unverified claim.</p></div>
          <div className="lp-card"><h3>Roles are enforced</h3><p>Only the Finance Director can approve or close. Each task can only be completed by its owner. Every decision is in the audit trail.</p></div>
        </div>
      </section>

      <section className="lp-sec" id="agents">
        <p className="lp-kicker">The team inside</p>
        <h2>Eight roles, each with one job</h2>
        <div className="lp-agents">
          {[
            ["Incident Commander", "Plans the investigation and writes the briefing"],
            ["Evidence Agent", "Reads the original invoices, receipts and emails"],
            ["Relationship Agent", "Finds shared bank accounts, phones and addresses"],
            ["Control Agent", "Picks and runs the company's policy checks"],
            ["Exposure engine", "Calculates the money at risk (pure code)"],
            ["Challenge Agent", "Argues for the innocent explanation"],
            ["Resolution Agent", "Proposes holds, callbacks and checks for approval"],
            ["Verification Agent", "Retests the controls after the fix"],
          ].map(([n, d]) => <div key={n}><b>{n}</b><span>{d}</span></div>)}
        </div>
      </section>

      <section className="lp-sec alt" id="vultr">
        <p className="lp-kicker">Built on Vultr</p>
        <h2>Four Vultr services, each doing real work</h2>
        <div className="lp-grid4">
          <div className="lp-card"><h3>Cloud Compute</h3><p>Runs the app, the LangGraph agent workflow and the rules engine.</p></div>
          <div className="lp-card"><h3>Serverless Inference</h3><p>Every AI call from every agent. Cost is recorded per call and shown per incident.</p></div>
          <div className="lp-card"><h3>Managed PostgreSQL</h3><p>Records, cases and the audit trail. An approval waits safely here, even through a restart.</p></div>
          <div className="lp-card"><h3>Object Storage</h3><p>The original invoices, emails and receipts the agents read, and the signed closing reports.</p></div>
        </div>
      </section>

      <section className="lp-final">
        <h2>See it work on a real case in 3 minutes.</h2>
        <div className="lp-cta center">
          <button className="lp-btn big light" disabled={!!busy} onClick={() => run("INC-0412")}>{busy ? "Starting…" : "Run the live demo →"}</button>
          <a className="lp-btn big outline" href="/?view=incidents">Browse incidents</a>
        </div>
      </section>

      <footer className="lp-foot">
        <Logo />
        <p>All demo data is synthetic. Northstar Manufacturing Group, its people and suppliers are fictional. Follow the Money never pays anyone or contacts a supplier.</p>
        <p>Vultr Agent Rush · Challenge 2: Powering the Future of Work · <a href="/api/docs">API</a></p>
      </footer>
    </div>
  );
}

function Preview({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`lp-preview ${compact ? "compact" : ""}`} aria-label="Product preview">
      <div className="pv-bar"><i /><i /><i /><span>followthemoney · INC-0412</span></div>
      <div className="pv-body">
        <div className="pv-head">
          <div><p className="pv-k">Incident INC-0412</p><p className="pv-t">Three linked suppliers, near-limit invoices</p></div>
          <span className="pv-sev">High</span>
        </div>
        <div className="pv-nums">
          <div><span>Potential exposure</span><b>$144,000</b></div>
          <div><span>Not received</span><b className="o">$67,800</b></div>
          <div><span>Payment run in</span><b>33 h</b></div>
        </div>
        <div className="pv-link">
          <div className="pv-sup">Kestrel Industrial</div>
          <div className="pv-sup">Ridgeline Components</div>
          <div className="pv-sup">Halvorsen Tooling</div>
          <div className="pv-bank">One bank account ****4821</div>
        </div>
        {!compact && (
          <ul className="pv-checks">
            <li className="bad">Bank details changed 7 days ago, no callback</li>
            <li className="bad">200 billed, 120 received</li>
            <li className="warn">Email claims "verified by your CFO": unverified</li>
            <li className="good">Harmless explanation tested: no contract covers it</li>
          </ul>
        )}
        <div className="pv-foot"><span className="pv-pill">Awaiting Finance Director</span><span className="pv-btn">Approve plan</span></div>
      </div>
    </div>
  );
}
