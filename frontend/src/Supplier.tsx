import { useEffect, useState } from "react";
import { get, usd } from "./api";
import { DrawerProvider, Cite } from "./ctx";
import { NetworkExplorer } from "./Network";

type SupplierData = {
  supplier: Record<string, string>; invoices: { id: string; amount: number; status: string; invoice_date: string; po_id: string }[];
  payments: { id: string; amount: number; status: string; run_id: string; invoice_id: string }[];
  links: { from: string; to: string; attribute: string; strength: string; explanation: string }[];
  incidents: { id: string; title: string }[]; changes: { id: string; field: string; old_value: string; new_value: string; changed_at: string; callback_verified: boolean; reason: string }[];
  in_run: number; run: { id: string };
};

export function SupplierPage({ id }: { id: string }) {
  const [d, setD] = useState<SupplierData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get<SupplierData>(`/api/suppliers/${id}`).then(setD).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <main className="page"><p className="error">{err}</p></main>;
  if (!d) return <main className="page"><p className="muted">Loading supplier</p></main>;
  const s = d.supplier;
  const linked = [...new Set(d.links.filter((l) => l.strength !== "weak").map((l) => (l.from === id ? l.to : l.from)))];
  const recentChange = d.changes.find((c) => c.field === "bank_account_token" && !c.callback_verified);
  return (
    <DrawerProvider caseId="">
      <main className="case">
        <section className="casehead">
          <div className="casehead-main">
            <nav className="crumbs"><a href="/">Home</a><span>›</span><a href="/?view=incidents">Incidents</a><span>›</span><span>Suppliers</span><span>›</span><b>{s.id}</b></nav>
            <div className="titleline"><h1 className="suph">{s.legal_name}</h1><span className="chip">{s.id}</span>
              {d.incidents.map((i) => <a key={i.id} className="sev sev-High" href={`/?case=${i.id}`}>{i.id}</a>)}</div>
            <p className="casetitle">{s.address} · {s.phone} · {s.contact_email}</p>
            <p className="fine">Supplier since {s.created_at} · bank {s.bank_account_token} at {s.bank_name} · due diligence {s.due_diligence}</p>
          </div>
          <div className="kpis">
            <div><span>Due in {d.run.id}</span><strong className="money">{usd(d.in_run)}</strong><em>{d.payments.filter((p) => p.run_id === d.run.id).length} payments</em></div>
            <div><span>Linked suppliers</span><strong>{linked.length}</strong><em>{linked.join(", ") || "none"}</em></div>
            <div><span>Bank change</span><strong className={recentChange ? "red" : ""}>{recentChange ? "Unverified" : "None open"}</strong><em>{recentChange ? `${recentChange.old_value} → ${recentChange.new_value}` : "no recent change without callback"}</em></div>
          </div>
        </section>
        <section className="panel nxpanel" data-tour="network">
          <div className="panel-head"><h2>Network around {s.legal_name}</h2>
            <span className="muted">Two steps out: its bank account, phone, address, requests, invoices, payments, and anyone sharing them. Double-click to go further.</span></div>
          <NetworkExplorer seeds={[id]} onOpenSupplier={(sid) => { location.href = `/?supplier=${sid}`; }} />
        </section>
        <div className="grid2">
          <section className="panel">
            <div className="panel-head"><h2>Invoices and payments</h2></div>
            <table className="table"><thead><tr><th>Invoice</th><th>Date</th><th className="num">Amount</th><th>ERP status</th><th>Payment</th></tr></thead>
              <tbody>{d.invoices.map((i) => {
                const p = d.payments.find((x) => x.invoice_id === i.id);
                return <tr key={i.id}><td><Cite id={i.id} /></td><td>{i.invoice_date}</td><td className="num money">{usd(i.amount)}</td>
                  <td>{i.status.replaceAll("_", " ")}</td><td>{p ? `${p.run_id} · ${p.status.replace("_", " ")}` : "not scheduled"}</td></tr>;
              })}</tbody></table>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Shared identifiers and changes</h2></div>
            <ul className="findings">
              {d.links.map((l, i) => <li key={i}><span className={`lab ${l.strength === "weak" ? "lab-Unresolved" : "lab-Confirmed"}`}>{l.strength}</span>
                {l.explanation} with <a href={`/?supplier=${l.from === id ? l.to : l.from}`}>{l.from === id ? l.to : l.from}</a></li>)}
              {d.changes.map((c) => <li key={c.id}><span className={`lab ${c.callback_verified ? "lab-Confirmed" : "lab-Unresolved"}`}>{c.callback_verified ? "verified" : "no callback"}</span>
                {c.changed_at.slice(0, 10)}: {c.field.replaceAll("_", " ")} {c.old_value} → {c.new_value} ({c.reason})</li>)}
              {!d.links.length && !d.changes.length && <li className="muted">No shared identifiers or recent changes.</li>}
            </ul>
          </section>
        </div>
      </main>
    </DrawerProvider>
  );
}
