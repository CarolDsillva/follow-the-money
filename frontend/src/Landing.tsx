import { useState } from "react";
import { post } from "./api";
import { MoneyMap, useNetwork } from "./MoneyMap";

export function myRuns(): string[] {
  try { return JSON.parse(localStorage.getItem("myRuns") ?? "[]"); } catch { return []; }
}

export function rememberRun(id: string) {
  localStorage.setItem("myRuns", JSON.stringify([id, ...myRuns().filter((x) => x !== id)].slice(0, 50)));
}

export async function startDemo(template = "INC-0412") {
  const { id } = await post<{ id: string }>(`/api/cases/${template}/rerun`);
  rememberRun(id);
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
  const ex412 = net?.featured?.find((f) => f.startsWith("INC-0412")) ?? "INC-0412";
  const example = (where: string) => where === "network" ? `/?case=${ex412}#network` : `/?case=${ex412}&tab=${encodeURIComponent(where)}`;
  const run = (t: string) => { setBusy(t); setErr(null); startDemo(t).catch((e) => { setErr(e.message); setBusy(null); }); };

  return (
    <div className="lp">
      <section className="fh">
        <div className="fh-glow" aria-hidden="true" />
        <header className="fh-nav">
          <Logo light />
          <nav>
            <a href="#cap">What it finds</a>
            <a href="#how">How it works</a>
            <a href="#vultr">Built on Vultr</a>
            <a href="/?view=scan">Scan your data</a>
          </nav>
          <a className="fh-signin" href="/?view=incidents">Open the app <span>→</span></a>
        </header>
        <div className="fh-body">
        <div className="fh-copy">
          <h1>Follow every dollar<br />before it leaves.</h1>
          <p>AI agents trace each payment back to its supplier, invoice, delivery and bank details, flag what doesn't add up, and wait for a person to approve every action.</p>
          <div className="fh-cta">
            <button className="fh-btn" disabled={!!busy} onClick={() => run("INC-0412")}>{busy ? "Starting the agents…" : "Run the live demo"} <span>→</span></button>
            <span className="fh-note">No sign-up · fictional data</span>
          </div>
          {err && <p className="lp-err">{err}</p>}
        </div>
        <div className="fh-map"><MoneyMap net={net} onPick={(id) => { location.href = `/?case=${id}`; }} /></div>
        </div>
        <p className="fh-hint2"><i /> Red: suppliers under investigation · hover any dot, click to open</p>
      </section>

      <section className="cap" id="cap">
        <p className="lp-kicker">The question we answer</p>
        <h2 className="cap-q">Are several legitimate-looking payments connected in a way that reveals a bigger control failure?</h2>
        <p className="cap-sub">Invoice checks look at one record at a time. Follow the Money looks at the network: who shares what, who approved what, and in what order it happened.</p>
        <div className="cap-grid">
          <article className="cap-card">
            <svg viewBox="0 0 220 120" className="cap-art" aria-hidden="true">
              <line x1="40" y1="25" x2="150" y2="62" /><line x1="40" y1="62" x2="150" y2="62" /><line x1="40" y1="99" x2="150" y2="62" />
              <circle cx="40" cy="25" r="11" className="s" /><circle cx="40" cy="62" r="11" className="s" /><circle cx="40" cy="99" r="11" className="s" />
              <circle cx="160" cy="62" r="17" className="b" /><text x="160" y="67">$</text>
              <text x="60" y="29" className="l">Kestrel</text><text x="60" y="66" className="l">Ridgeline</text><text x="60" y="103" className="l">Halvorsen</text>
            </svg>
            <span className="cap-n">01</span>
            <h3>Cross-supplier identity discovery</h3>
            <p>One supplier can hide behind several registered names, bank accounts, addresses or phone numbers. We link apparently unrelated suppliers through shared identifiers and payment history.</p>
            <p className="cap-ex"><b>In the demo:</b> three "different" suppliers share one bank account, one phone and one unit address.</p>
            <a className="cap-where" href={example("network")}>See it on the network graph →</a>
          </article>
          <article className="cap-card">
            <svg viewBox="0 0 220 120" className="cap-art" aria-hidden="true">
              <line x1="20" y1="26" x2="210" y2="26" className="lim" /><text x="208" y="20" className="r">$50,000 limit</text>
              <rect x="40" y="33" width="34" height="77" rx="3" /><rect x="93" y="31" width="34" height="79" rx="3" /><rect x="146" y="29" width="34" height="81" rx="3" />
              <text x="57" y="74" className="w">47k</text><text x="110" y="74" className="w">48k</text><text x="163" y="74" className="w">49k</text>
            </svg>
            <span className="cap-n">02</span>
            <h3>Approval-pattern manipulation</h3>
            <p>An employee splits a purchase across requests, suppliers or invoices to stay under the approval threshold. We rebuild the sequence and find the pattern single-invoice checks miss.</p>
            <p className="cap-ex"><b>In the demo:</b> one requester, one approver, three requests in 39 minutes, each just under $50,000, together $144,000.</p>
            <a className="cap-where" href={example("Investigation")}>See it in the control tests →</a>
          </article>
          <article className="cap-card">
            <svg viewBox="0 0 220 120" className="cap-art" aria-hidden="true">
              <line x1="16" y1="60" x2="206" y2="60" className="tl" />
              {[22, 62, 102, 142, 182].map((x, i) => <circle key={x} cx={x} cy="60" r="8" className={i === 2 ? "x" : "t"} />)}
              <text x="22" y="40" className="m">created</text><text x="62" y="92" className="m">requests</text><text x="102" y="40" className="m xr">bank changed</text>
              <text x="142" y="92" className="m">short receipt</text><text x="182" y="40" className="m">payment</text>
            </svg>
            <span className="cap-n">03</span>
            <h3>Financial event reconstruction</h3>
            <p>Supplier changes, purchase orders, receipts, approvals and payments, put in order. We rebuild the timeline and show exactly where each control failed.</p>
            <p className="cap-ex"><b>In the demo:</b> a bank change requested by a look-alike email 7 days before payment, and $67,800 billed but never received.</p>
            <a className="cap-where" href={example("Timeline")}>See it on the timeline →</a>
          </article>
        </div>
        <div className="cap-cta">
          <button className="lp-btn big" disabled={!!busy} onClick={() => run("INC-0412")}>{busy ? "Starting…" : "See all three in the live demo →"}</button>
          <span className="lp-note">A guided tour points out each one as the agents work.</span>
        </div>
      </section>

      <section className="lp-sec alt" id="how">
        <p className="lp-kicker">How it works</p>
        <h2>The AI argues. Code decides. People approve.</h2>
        <ol className="lp-steps">
          <li><span>1</span><h3>Detect</h3><p>A rule scans the next payment run for invoices just under the approval limit from connected suppliers.</p><em>Code</em></li>
          <li><span>2</span><h3>Investigate</h3><p>Eight AI specialists read the original documents, map the network, run policy checks and argue for the innocent explanation.</p><em>AI agents</em></li>
          <li><span>3</span><h3>Approve</h3><p>The Finance Director sees the evidence and the exposure, and approves each action. Nothing can pay anyone.</p><em>Human</em></li>
          <li><span>4</span><h3>Verify</h3><p>After the teams act, every control is retested. The case closes only when all checks pass.</p><em>Code</em></li>
        </ol>
        <div className="lp-nums">
          <div><b>~90 s</b><span>alert to decision-ready briefing</span></div>
          <div><b>$144,000</b><span>exposure scoped, every dollar traced to a record</span></div>
          <div><b>~$0.07</b><span>of AI inference per incident, measured live</span></div>
          <div><b>0</b><span>accusations on the harmless look-alike case</span></div>
        </div>
      </section>

      <section className="vx" id="vultr">
        <div className="vx-glow" aria-hidden="true" />
        <div className="vx-text">
          <p className="lp-kicker light">Built on Vultr</p>
          <h2>Every step of the investigation runs on Vultr.</h2>
          <p>The agents, the rules engine, the database that holds approvals and the documents they read all live on four Vultr services. No other AI provider is in the code.</p>
          <ul className="vx-facts">
            <li><b>Seattle</b> compute, database and AI · <b>San Jose</b> document storage</li>
            <li><b>2 models</b> glm-5.3 and qwen3.8 on Serverless Inference</li>
            <li><b>0 secrets</b> in the browser or the repository</li>
          </ul>
        </div>
        <div className="vx-diagram" aria-label="Architecture on Vultr">
          <svg className="vx-lines" viewBox="0 0 600 420" preserveAspectRatio="none" aria-hidden="true">
            <path d="M300 210 L300 70" /><path d="M300 210 L110 350" /><path d="M300 210 L490 350" />
          </svg>
          <div className="vx-node vx-top">
            <span className="vx-ico">AI</span>
            <div><h3>Serverless Inference</h3><p>Every model call from every agent, with cost per call</p></div>
          </div>
          <div className="vx-node vx-core">
            <span className="vx-ico">VM</span>
            <div><h3>Cloud Compute</h3><p>LangGraph agents, rules engine, API and app</p></div>
          </div>
          <div className="vx-node vx-left">
            <span className="vx-ico">DB</span>
            <div><h3>Managed PostgreSQL</h3><p>Records, audit trail, approvals that survive restarts</p></div>
          </div>
          <div className="vx-node vx-right">
            <span className="vx-ico">S3</span>
            <div><h3>Object Storage</h3><p>56 original documents and signed closing reports</p></div>
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="fh-glow" aria-hidden="true" />
        <div className="lf-inner">
          <p className="lp-kicker light">Live demo</p>
          <h2>See it work on a real case in 3 minutes.</h2>
          <p>Eight agents, one suspicious payment run, and you as the Finance Director. A short tour shows you around.</p>
          <div className="fh-cta">
            <button className="fh-btn" disabled={!!busy} onClick={() => run("INC-0412")}>{busy ? "Starting the agents…" : "Run the live demo"} <span>→</span></button>
            <a className="fh-signin ghosted" href="/?view=incidents">Browse incidents <span>→</span></a>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <Logo />
        <p>All demo data is synthetic. Northstar Manufacturing Group, its people and suppliers are fictional. Follow the Money never pays anyone or contacts a supplier.</p>
        <p>Vultr Agent Rush · Challenge 2: Powering the Future of Work · <a href="https://github.com/CarolDsillva/follow-the-money">Source on GitHub</a></p>
      </footer>
    </div>
  );
}
