import { useRef, useState } from "react";
import { post, usd } from "./api";
import { DrawerProvider } from "./ctx";
import { NetworkExplorer, type Focus } from "./Network";

type Finding = { type: string; invoices: string[]; suppliers: string[]; total: number; reason: string };
type Result = { suppliers: number; invoices: number; total: number; limit: number; findings: Finding[];
  links: { from: string; to: string; attribute: string; strength: string; explanation: string }[]; problems: string[];
  graph: { nodes: never[]; edges: never[] }; seeds: string[] };
type Rows = Record<string, string>[];

const NEEDS = {
  suppliers: ["id", "name", "bank_account"],
  invoices: ["id", "supplier_id", "amount"],
};
const OPTIONAL = {
  suppliers: ["phone", "address"],
  invoices: ["date", "requester", "approver"],
};
const EXPLAIN: Record<string, { title: string; why: string; tone: string }> = {
  "near-limit cluster": { title: "Invoices just under the approval limit", why: "Several invoices at 90 to 100% of the limit from the same or linked suppliers. A classic way to avoid a higher approval.", tone: "rose" },
  "possible split purchase": { title: "One person, several purchases in a week", why: "One requester raised purchases that together exceed the limit while each stays under it. Check for a framework agreement.", tone: "blue" },
};

function parseCsv(text: string): Rows {
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

function template(kind: "suppliers" | "invoices") {
  const head = [...NEEDS[kind], ...OPTIONAL[kind]].join(",");
  const url = URL.createObjectURL(new Blob([head + "\n"], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = `${kind}-template.csv`; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function DropZone({ kind, rows, onRows }: { kind: "suppliers" | "invoices"; rows: Rows | null; onRows: (r: Rows, name: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [name, setName] = useState("");
  const take = (f?: File) => f && f.text().then((t) => { setName(f.name); onRows(parseCsv(t), f.name); });
  const cols = rows?.length ? Object.keys(rows[0]) : [];
  const missing = rows ? NEEDS[kind].filter((c) => !cols.includes(c)) : [];
  return (
    <div className={`drop ${over ? "over" : ""} ${rows ? (missing.length ? "bad" : "good") : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }} onClick={() => input.current?.click()}>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => take(e.target.files?.[0])} />
      <b>{kind === "suppliers" ? "Suppliers file" : "Invoices file"}</b>
      {!rows ? (
        <span>Drop a CSV here or click to choose<br /><small>Needs: {NEEDS[kind].join(", ")}. Optional: {OPTIONAL[kind].join(", ")}</small></span>
      ) : missing.length ? (
        <span className="dz-bad">Missing column{missing.length > 1 ? "s" : ""}: {missing.join(", ")}</span>
      ) : (
        <>
          <span className="dz-good">✓ {name || "loaded"} · {rows.length} rows</span>
          <table className="dz-prev"><tbody>{rows.slice(0, 3).map((r, i) => <tr key={i}>{NEEDS[kind].map((k) => <td key={k}>{r[k]}</td>)}</tr>)}</tbody></table>
        </>
      )}
    </div>
  );
}

export function ScanPage() {
  const [sup, setSup] = useState<Rows | null>(null);
  const [inv, setInv] = useState<Rows | null>(null);
  const [limit, setLimit] = useState(50000);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const valid = (r: Rows | null, k: "suppliers" | "invoices") => !!r?.length && NEEDS[k].every((c) => c in r[0]);

  async function run(s = sup, i = inv) {
    if (!s || !i) return;
    setBusy(true); setErr(null); setFocus(null); setPicked(null);
    try {
      const r = await post<Result>("/api/scan", { suppliers: s, invoices: i, limit });
      setRes(r);
      window.setTimeout(() => document.getElementById("scan-results")?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function sample() {
    setBusy(true);
    const [s, i] = await Promise.all([fetch("/api/scan/sample/suppliers.csv").then((r) => r.text()), fetch("/api/scan/sample/invoices.csv").then((r) => r.text())]);
    const S = parseCsv(s), I = parseCsv(i);
    setSup(S); setInv(I);
    await run(S, I);
  }
  function pick(k: number, f: Finding) {
    setPicked(k);
    setFocus({ ids: [...f.suppliers, ...f.invoices], caption: f.reason, agent: EXPLAIN[f.type]?.title ?? f.type });
    document.getElementById("scan-network")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <DrawerProvider caseId="">
      <main className="page">
        <section className="scan-hero">
          <div>
            <h1>Scan your own data</h1>
            <p>Find hidden links between your suppliers and purchases that dodge the approval limit, in seconds. Upload two CSV files from your ERP or spreadsheet.
              Only deterministic rules run: no AI looks at your data, and nothing is stored.</p>
          </div>
          <button className="primary big" disabled={busy} onClick={sample}>{busy && !sup ? "Scanning…" : "Try it with the sample →"}</button>
        </section>

        <section className="scan-steps">
          <div className="scan-step">
            <span className="sn">1</span>
            <h3>Get your files ready</h3>
            <p>One row per supplier and one row per invoice. Column names matter; order doesn't.</p>
            <div className="scan-links">
              <button onClick={() => template("suppliers")}>Suppliers template</button>
              <button onClick={() => template("invoices")}>Invoices template</button>
            </div>
            <p className="fine">Or look at the Northstar examples: <a href="/api/scan/sample/suppliers.csv">suppliers</a> · <a href="/api/scan/sample/invoices.csv">invoices</a></p>
          </div>
          <div className="scan-step wide">
            <span className="sn">2</span>
            <h3>Upload them</h3>
            <div className="drops">
              <DropZone kind="suppliers" rows={sup} onRows={(r) => { setSup(r); setRes(null); }} />
              <DropZone kind="invoices" rows={inv} onRows={(r) => { setInv(r); setRes(null); }} />
            </div>
          </div>
          <div className="scan-step">
            <span className="sn">3</span>
            <h3>Scan</h3>
            <label className="limit">Your approval limit<input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
            <button className="primary big" disabled={!valid(sup, "suppliers") || !valid(inv, "invoices") || busy} onClick={() => run()}>{busy ? "Scanning…" : "Scan my data"}</button>
            {err && <p className="error">{err}</p>}
          </div>
        </section>

        {res && (
          <div id="scan-results">
            <section className="lp-nums scan-nums">
              <div><b>{res.suppliers}</b><span>suppliers checked</span></div>
              <div><b>{res.invoices}</b><span>invoices, {usd(res.total)}</span></div>
              <div><b>{res.links.filter((l) => l.strength !== "weak").length}</b><span>shared bank accounts, phones or addresses</span></div>
              <div><b>{res.findings.length}</b><span>patterns worth a closer look</span></div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>What we found</h2><span className="muted">Click a finding to light it up in the network below. A pattern is a reason to look, not proof.</span></div>
              {res.findings.length === 0 && <p className="muted">Nothing matched the rules. That's a good sign.</p>}
              <div className="fcards">
                {res.findings.map((f, k) => {
                  const e = EXPLAIN[f.type] ?? { title: f.type, why: "", tone: "blue" };
                  return (
                    <button key={k} className={`fcard t-${e.tone} ${picked === k ? "on" : ""}`} onClick={() => pick(k, f)}>
                      <span className="ft">{e.title}</span>
                      <b>{usd(f.total)}</b>
                      <p>{f.reason}</p>
                      <small>{f.suppliers.length} supplier{f.suppliers.length > 1 ? "s" : ""} · {f.invoices.length} invoices · {e.why}</small>
                      <em>Show in network →</em>
                    </button>
                  );
                })}
              </div>
              {res.problems.length > 0 && <details className="rejected"><summary>{res.problems.length} rows skipped</summary><ul>{res.problems.map((p) => <li key={p}>{p}</li>)}</ul></details>}
            </section>
            <section className="panel nxpanel" id="scan-network">
              <div className="panel-head"><h2>Network of what was flagged</h2>
                <span className="muted">Suppliers in a pattern, the identifiers they share and the invoices involved. {res.links.filter((l) => l.strength === "weak").length > 0 && "Addresses shared by many companies (business parks) are treated as weak."}</span></div>
              <NetworkExplorer seeds={res.seeds} hops={3} data={res.graph} focus={focus} />
            </section>
          </div>
        )}
      </main>
    </DrawerProvider>
  );
}
