import { useState } from "react";
import { post, usd } from "./api";
import { DrawerProvider } from "./ctx";
import { NetworkExplorer } from "./Network";

type Finding = { type: string; invoices: string[]; suppliers: string[]; total: number; reason: string };
type Result = { suppliers: number; invoices: number; total: number; limit: number; findings: Finding[];
  links: { from: string; to: string; attribute: string; strength: string; explanation: string }[]; problems: string[];
  graph: { nodes: never[]; edges: never[] }; seeds: string[] };

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  const keys = (head ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function ScanPage() {
  const [sup, setSup] = useState<Record<string, string>[] | null>(null);
  const [inv, setInv] = useState<Record<string, string>[] | null>(null);
  const [limit, setLimit] = useState(50000);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const read = (f: File | undefined, set: (r: Record<string, string>[]) => void) => { if (f) f.text().then((t) => set(parseCsv(t))); };
  async function loadSample() {
    const [s, i] = await Promise.all([fetch("/api/scan/sample/suppliers.csv").then((r) => r.text()), fetch("/api/scan/sample/invoices.csv").then((r) => r.text())]);
    setSup(parseCsv(s)); setInv(parseCsv(i)); setRes(null);
  }
  async function run() {
    if (!sup || !inv) return;
    setBusy(true); setErr(null);
    try { setRes(await post<Result>("/api/scan", { suppliers: sup, invoices: inv, limit })); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <DrawerProvider caseId="">
      <main className="page">
        <section className="inbox-head">
          <div>
            <h1>Scan your own data</h1>
            <p className="muted">Upload a suppliers file and an invoices file. Code checks them for shared bank accounts, phones and addresses, near-limit clusters
              and possible split purchases, the same rules the payment-run scan uses. No AI runs on your data and nothing is stored.</p>
          </div>
          <div className="runcard">
            <p className="eyebrow">CSV format</p>
            <p className="fine"><b>suppliers.csv</b>: id, name, bank_account, phone, address</p>
            <p className="fine"><b>invoices.csv</b>: id, supplier_id, amount, date, requester, approver</p>
            <p className="fine"><a href="/api/scan/sample/suppliers.csv" style={{ color: "#7dd3fc" }}>Sample suppliers</a> · <a href="/api/scan/sample/invoices.csv" style={{ color: "#7dd3fc" }}>Sample invoices</a></p>
          </div>
        </section>
        <section className="panel scanform">
          <label>Suppliers CSV<input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files?.[0], setSup)} /><span className="fine">{sup ? `${sup.length} rows` : "no file"}</span></label>
          <label>Invoices CSV<input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files?.[0], setInv)} /><span className="fine">{inv ? `${inv.length} rows` : "no file"}</span></label>
          <label>Approval limit<input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
          <div className="scanbtns">
            <button onClick={loadSample}>Use the Northstar sample</button>
            <button className="primary" disabled={!sup || !inv || busy} onClick={run}>{busy ? "Scanning…" : "Scan"}</button>
          </div>
          {err && <p className="error">{err}</p>}
        </section>
        {res && (
          <>
            <section className="lp-nums scan-nums">
              <div><b>{res.suppliers}</b><span>suppliers</span></div>
              <div><b>{res.invoices}</b><span>invoices, {usd(res.total)}</span></div>
              <div><b>{res.links.filter((l) => l.strength !== "weak").length}</b><span>shared identifiers between suppliers</span></div>
              <div><b>{res.findings.length}</b><span>patterns worth investigating</span></div>
            </section>
            <div className="grid2">
              <section className="panel">
                <div className="panel-head"><h2>Patterns found</h2><span className="muted">A pattern is a reason to look, not proof.</span></div>
                {res.findings.length === 0 && <p className="muted">Nothing matched the rules.</p>}
                <ul className="findings">
                  {res.findings.map((f, k) => (
                    <li key={k}><span className={`lab ${f.type === "near-limit cluster" ? "lab-Unresolved" : "lab-Supported"}`}>{f.type}</span>
                      {f.reason} <span className="fine">· {f.invoices.join(", ")} · {usd(f.total)}</span></li>
                  ))}
                </ul>
                {res.problems.length > 0 && <details className="rejected"><summary>{res.problems.length} rows skipped</summary><ul>{res.problems.map((p) => <li key={p}>{p}</li>)}</ul></details>}
              </section>
              <section className="panel">
                <div className="panel-head"><h2>Shared identifiers</h2></div>
                <ul className="findings">
                  {res.links.slice(0, 14).map((l, k) => <li key={k}><span className={`lab ${l.strength === "weak" ? "lab-Unresolved" : "lab-Confirmed"}`}>{l.strength}</span>{l.from} and {l.to}: {l.explanation}</li>)}
                </ul>
              </section>
            </div>
            <section className="panel nxpanel">
              <div className="panel-head"><h2>Network of what was flagged</h2><span className="muted">Suppliers in a pattern, their shared identifiers and the invoices involved.</span></div>
              <NetworkExplorer seeds={res.seeds} hops={3} data={res.graph} />
            </section>
          </>
        )}
      </main>
    </DrawerProvider>
  );
}
