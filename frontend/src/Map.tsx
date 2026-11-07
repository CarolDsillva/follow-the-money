import { useMemo, useState } from "react";
import { get, type Graph } from "./api";

const COLS = [
  { col: 0, title: "Shared attributes" },
  { col: 1, title: "Suppliers" },
  { col: 2, title: "Requests and people" },
  { col: 3, title: "Invoices" },
  { col: 4, title: "Payments" },
];
const W = 1120, COLW = 224, NODEW = 184, NODEH = 46, GAP = 14, TOP = 44;

export function RelationshipMap({ graph, caseId }: { graph: Graph; caseId: string }) {
  const [sel, setSel] = useState<{ title: string; body: string; id?: string } | null>(null);
  const [rec, setRec] = useState<any>(null);

  const layout = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const cols: Record<number, typeof graph.nodes> = {};
    for (const n of graph.nodes) {
      const col = Math.floor(n.col);
      (cols[col] ??= []).push(n);
    }
    let maxY = 0;
    for (const [col, nodes] of Object.entries(cols)) {
      nodes.sort((a, b) => (a.kind === "person" ? 1 : 0) - (b.kind === "person" ? 1 : 0) || a.id.localeCompare(b.id));
      nodes.forEach((n, i) => {
        const y = TOP + i * (NODEH + GAP) + (n.kind === "person" ? 18 : 0);
        pos[n.id] = { x: Number(col) * COLW + 12, y };
        maxY = Math.max(maxY, y + NODEH);
      });
    }
    return { pos, h: maxY + 20 };
  }, [graph]);

  async function pick(id: string, title: string, body: string) {
    setSel({ title, body, id });
    setRec(null);
    if (/^(SUP|PR|INV|PAY|EMP)-/.test(id)) {
      try { setRec(await get(`/api/records/${id}?case=${caseId}`)); } catch { setRec(null); }
    }
  }

  return (
    <div className="mapwrap">
      <section className="panel map">
        <div className="panel-head">
          <h2>Relationship map</h2>
          <span className="muted">{graph.investigated ? "Links from the deterministic matcher, assessed by the Relationship Agent. Click a line or a box for its evidence."
            : "Before investigation: three invoices from three suppliers, nothing connecting them."}</span>
        </div>
        <div className="legend">
          <span><i className="l-confirmed" />Confirmed link</span><span><i className="l-unconfirmed" />Unconfirmed (weak)</span>
          <span><i className="l-warning" />Warning</span><span><i className="l-fact" />Record chain</span>
        </div>
        <svg viewBox={`0 0 ${W} ${Math.max(layout.h, 260)}`} className="graph" role="img" aria-label="Relationship map">
          {COLS.map((c) => <text key={c.col} x={c.col * COLW + 12} y={22} className="colhead">{c.title}</text>)}
          {graph.edges.map((e, i) => {
            const a = layout.pos[e.from], b = layout.pos[e.to];
            if (!a || !b) return null;
            const x1 = a.x + NODEW, y1 = a.y + NODEH / 2, x2 = b.x, y2 = b.y + NODEH / 2;
            const back = x2 <= x1;
            const d = back
              ? `M${a.x + NODEW / 2},${a.y + NODEH} C${a.x + NODEW / 2},${a.y + NODEH + 40} ${b.x + NODEW / 2},${b.y + NODEH + 40} ${b.x + NODEW / 2},${b.y + NODEH}`
              : `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`;
            return (
              <g key={i} className={`edge e-${e.kind}`} onClick={() => pick(e.link_id ?? e.to, e.label, `${e.from} → ${e.to}`)}>
                <path d={d} className="hit" /><path d={d} />
              </g>
            );
          })}
          {graph.nodes.map((n) => {
            const p = layout.pos[n.id];
            return (
              <g key={n.id} className={`node k-${n.kind} ${n.flag ? "f-" + n.flag : ""}`} transform={`translate(${p.x},${p.y})`}
                onClick={() => pick(n.id, n.label, n.sub)}>
                <rect width={NODEW} height={NODEH} rx={8} />
                <text x={10} y={19} className="nl">{n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label}</text>
                <text x={10} y={36} className="ns">{n.flag ? n.flag.toUpperCase() + " · " : ""}{n.sub.length > 30 ? n.sub.slice(0, 29) + "…" : n.sub}</text>
              </g>
            );
          })}
        </svg>
      </section>
      {sel && (
        <aside className="panel side">
          <button className="x" onClick={() => setSel(null)} aria-label="Close">×</button>
          <h3>{sel.title}</h3>
          <p className="muted">{sel.body}</p>
          {sel.id && <p className="mono small">{sel.id}</p>}
          {rec && <pre className="rec">{JSON.stringify(rec.record, null, 2)}</pre>}
        </aside>
      )}
    </div>
  );
}
