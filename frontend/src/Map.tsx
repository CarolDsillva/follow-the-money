import { useMemo } from "react";
import type { Graph } from "./api";
import { useDrawer } from "./ctx";

const COLS = [
  { col: 0, title: "Shared attributes" },
  { col: 1, title: "Suppliers" },
  { col: 2, title: "Requests and people" },
  { col: 3, title: "Invoices" },
  { col: 4, title: "Payments" },
];
const W = 1120, COLW = 224, NODEW = 196, NODEH = 46, GAP = 14, TOP = 44;

export function RelationshipMap({ graph }: { graph: Graph }) {
  const { open } = useDrawer();

  const layout = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const cols: Record<number, typeof graph.nodes> = {};
    for (const n of graph.nodes) (cols[Math.floor(n.col)] ??= []).push(n);
    let maxY = 0;
    for (const [col, nodes] of Object.entries(cols)) {
      nodes.sort((a, b) => (a.kind === "person" ? 1 : 0) - (b.kind === "person" ? 1 : 0) || a.id.localeCompare(b.id));
      nodes.forEach((n, i) => {
        const y = TOP + i * (NODEH + GAP) + (n.kind === "person" ? 18 : 0);
        pos[n.id] = { x: Number(col) * COLW + 8, y };
        maxY = Math.max(maxY, y + NODEH);
      });
    }
    return { pos, h: maxY + 20 };
  }, [graph]);

  const refFor = (id: string) => {
    if (id.includes(":")) return graph.edges.find((e) => e.from === id)?.link_id ?? (graph.edges.find((e) => e.from === id) as { ref?: string } | undefined)?.ref;
    return id;
  };

  return (
    <section className="panel map">
      <div className="panel-head">
        <h2>Relationship map</h2>
        <span className="muted">{graph.investigated
          ? "Shared attributes found by the deterministic matcher and assessed by the Relationship Agent. Click any line or box for its evidence."
          : "Shared attributes found by the deterministic matcher when the incident opened. The Relationship Agent hasn't assessed them yet. Click any line or box for its evidence."}</span>
      </div>
      <div className="legend">
        <span><i className="l-confirmed" />Confirmed shared attribute</span>
        <span><i className="l-matcher" />Found by matcher, awaiting assessment</span>
        <span><i className="l-unconfirmed" />Weak (e.g. a business park)</span>
        <span><i className="l-warning" />Warning</span>
        <span><i className="l-fact" />Record chain (normal business link)</span>
      </div>
      <p className="fine">A shared attribute is a connection that needs verification, not proof of common ownership or misconduct.</p>
      <svg viewBox={`0 0 ${W} ${Math.max(layout.h, 260)}`} className="graph" role="img" aria-label="Relationship map">
        {COLS.map((c) => <text key={c.col} x={c.col * COLW + 8} y={22} className="colhead">{c.title}</text>)}
        {graph.edges.map((e, i) => {
          const a = layout.pos[e.from], b = layout.pos[e.to];
          if (!a || !b) return null;
          const x1 = a.x + NODEW, y1 = a.y + NODEH / 2, x2 = b.x, y2 = b.y + NODEH / 2;
          const back = x2 <= x1;
          const d = back
            ? `M${a.x + NODEW / 2},${a.y} C${a.x + NODEW / 2},${a.y - 30} ${b.x + NODEW / 2},${b.y + NODEH + 30} ${b.x + NODEW / 2},${b.y + NODEH}`
            : `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`;
          const ref = (e as { ref?: string }).ref ?? e.link_id ?? e.to;
          return (
            <g key={i} className={`edge e-${e.kind}`} onClick={() => open(ref)}>
              <title>{e.label}</title>
              <path d={d} className="hit" /><path d={d} />
            </g>
          );
        })}
        {graph.nodes.map((n) => {
          const p = layout.pos[n.id];
          const ref = refFor(n.id);
          return (
            <g key={n.id} className={`node k-${n.kind} ${n.flag ? "f-" + n.flag : ""}`} transform={`translate(${p.x},${p.y})`}
              onClick={() => ref && open(ref)}>
              <title>{n.label} · {n.sub}</title>
              <rect width={NODEW} height={NODEH} rx={8} />
              <text x={10} y={19} className="nl">{n.label.length > 27 ? n.label.slice(0, 26) + "…" : n.label}</text>
              <text x={10} y={36} className="ns">{n.flag ? n.flag.toUpperCase() + " · " : ""}{n.sub.length > 30 ? n.sub.slice(0, 29) + "…" : n.sub}</text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
