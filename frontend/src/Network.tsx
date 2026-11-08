import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useMemo, useRef, useState } from "react";
import { get, usd } from "./api";

type GNode = { id: string; type: string; label: string; flags: string[]; props: Record<string, unknown>; degree: number };
type GEdge = { id: string; source: string; target: string; type: string; amount: number | null; note: string };
type Graph = { nodes: GNode[]; edges: GEdge[] };

export const TYPES: Record<string, { label: string; color: string; icon: string }> = {
  supplier: { label: "Supplier", color: "#2563eb", icon: "M4 20V9l5 3V9l5 3V5h6v15z" },
  bank_account: { label: "Bank account", color: "#8b3a1f", icon: "M12 3 3 8v2h18V8zM5 11v6M9.5 11v6M14.5 11v6M19 11v6M3 19h18v2H3z" },
  phone: { label: "Phone", color: "#0891b2", icon: "M7 3h4l1 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 1v4c0 1-1 2-2 2C10 19 5 14 5 5c0-1 1-2 2-2z" },
  address: { label: "Address", color: "#65a30d", icon: "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" },
  person: { label: "Person", color: "#b7a31a", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9c0-4 3-6 7-6s7 2 7 6z" },
  request: { label: "Purchase request", color: "#64748b", icon: "M6 2h9l4 4v16H6zM9 10h7M9 14h7M9 18h4" },
  invoice: { label: "Invoice", color: "#0f766e", icon: "M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4" },
  receipt: { label: "Goods receipt", color: "#a16207", icon: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" },
  payment: { label: "Payment", color: "#16a34a", icon: "M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" },
  change: { label: "Master-data change", color: "#ea580c", icon: "M4 8h13l-3-3M20 16H7l3 3" },
  email: { label: "Email", color: "#db2777", icon: "M3 5h18v14H3zM3 6l9 7 9-7" },
  contract: { label: "Contract", color: "#7c3aed", icon: "M6 2h12v20H6zM9 7h6M9 11h6M8 18c2-2 3 1 5-1s2 1 3 0" },
};

const RISKY_EDGES = new Set(["IMITATES", "REQUESTED_CHANGE", "NEW_ACCOUNT"]);

function icon(type: string) {
  const t = TYPES[type] ?? TYPES.request;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${t.icon}" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function neighbours(g: Graph, ids: Set<string>, hops: number, skipHubs = true) {
  const adj = new Map<string, string[]>();
  for (const e of g.edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const type = new Map(g.nodes.map((n) => [n.id, n.type]));
  const seen = new Set(ids);
  let frontier = [...ids];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      // People approve many requests: don't walk outward through them unless asked.
      if (skipHubs && h > 0 && type.get(id) === "person") continue;
      for (const n of adj.get(id) ?? []) if (!seen.has(n)) { seen.add(n); next.push(n); }
    }
    frontier = next;
  }
  return seen;
}

export function NetworkExplorer({ caseId = "", seeds, hops = 2, onOpenSupplier, compact = false }:
  { caseId?: string; seeds: string[]; hops?: number; onOpenSupplier?: (id: string) => void; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const [g, setG] = useState<Graph | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [offTypes, setOffTypes] = useState<Set<string>>(new Set(["receipt"]));
  const [offEdges, setOffEdges] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"nodes" | "edges">("nodes");
  const [bounds, setBounds] = useState<[number, number]>([0, 0]);
  const [sel, setSel] = useState<GNode | GEdge | null>(null);
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(false);
  const [showFilters, setShowFilters] = useState(!compact);
  const seedKey = seeds.join(",");

  useEffect(() => {
    get<Graph>(`/api/entity-graph${caseId ? `?case=${caseId}` : ""}`).then((gr) => {
      setG(gr);
      setVisible(neighbours(gr, new Set(seeds), hops));
      const max = Math.max(0, ...gr.edges.map((e) => e.amount ?? 0));
      setBounds([0, Math.ceil(max / 1000) * 1000]);
    });
  }, [caseId, seedKey, hops]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    if (!g) return { nodes: [] as GNode[], edges: [] as GEdge[] };
    const nodes = g.nodes.filter((n) => visible.has(n.id) && !offTypes.has(n.type));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && !offEdges.has(e.type)
      && (e.amount == null || (e.amount >= bounds[0] && e.amount <= bounds[1])));
    return { nodes, edges };
  }, [g, visible, offTypes, offEdges, bounds]);

  // build / rebuild the canvas
  useEffect(() => {
    if (!box.current || !g) return;
    const maxAmt = Math.max(1, ...g.edges.map((e) => e.amount ?? 0));
    const els: ElementDefinition[] = [
      ...shown.nodes.map((n) => ({
        data: { id: n.id, label: n.label, type: n.type, color: (TYPES[n.type] ?? TYPES.request).color, icon: icon(n.type),
          size: 34 + Math.min(30, n.degree * 2.2), risk: n.flags.length > 0 && !n.flags.every((f) => f.startsWith("business park")) ? 1 : 0,
          seed: seeds.includes(n.id) ? 1 : 0, badge: String(n.degree) },
      })),
      ...shown.edges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, type: e.type, w: e.amount ? 1 + (6 * e.amount) / maxAmt : 1,
          risky: RISKY_EDGES.has(e.type) ? 1 : 0, money: e.type === "SENDS_MONEY_TO" ? 1 : 0 },
      })),
    ];
    const prev = cy.current;
    const positions = new Map<string, { x: number; y: number }>();
    prev?.nodes().forEach((n) => { positions.set(n.id(), { ...n.position() }); });
    prev?.destroy();
    const c = cytoscape({
      container: box.current, elements: els, wheelSensitivity: 0.25, minZoom: 0.2, maxZoom: 3,
      style: [
        { selector: "node", style: { "background-color": "data(color)", "background-image": "data(icon)", "background-fit": "none",
          "background-width": "56%", "background-height": "56%", width: "data(size)", height: "data(size)", label: "data(label)",
          "font-family": "Inter Variable, sans-serif", "font-size": 12, "font-weight": 600, color: "#1e293b", "text-valign": "bottom",
          "text-margin-y": 6, "text-background-color": "#ffffff", "text-background-opacity": 0.85, "text-background-padding": "2px",
          "text-background-shape": "roundrectangle", "border-width": 3, "border-color": "#ffffff", "text-max-width": "140px", "text-wrap": "ellipsis" } },
        { selector: "node[risk = 1]", style: { "border-color": "#e11d48", "border-width": 4, "overlay-color": "#e11d48", "overlay-opacity": 0, "underlay-color": "#fb7185", "underlay-opacity": 0.35, "underlay-padding": 7, "underlay-shape": "ellipse" } },
        { selector: "node[seed = 1]", style: { "font-size": 14, "font-weight": 800 } },
        { selector: "node:selected", style: { "border-color": "#0f172a", "border-width": 4, "underlay-color": "#38bdf8", "underlay-opacity": 0.45, "underlay-padding": 10 } },
        { selector: "edge", style: { width: "data(w)", "line-color": "#c3cbd6", "curve-style": "bezier", "target-arrow-shape": "triangle", "target-arrow-color": "#c3cbd6",
          "arrow-scale": 0.8, opacity: 0.9 } },
        { selector: "edge[risky = 1]", style: { "line-color": "#e11d48", "target-arrow-color": "#e11d48", "line-style": "dashed", width: 2.4 } },
        { selector: "edge:selected", style: { "line-color": "#0f172a", "target-arrow-color": "#0f172a", width: 3 } },
        { selector: ".dim", style: { opacity: 0.12 } },
        { selector: "edge.flow", style: { "line-color": "#16a34a", "target-arrow-color": "#16a34a", width: 5, opacity: 1, "line-style": "solid" } },
        { selector: "node.hit", style: { "underlay-color": "#facc15", "underlay-opacity": 0.6, "underlay-padding": 12 } },
      ],
      layout: positions.size ? { name: "preset", positions: (n: { id: () => string }) => positions.get(n.id()) ?? { x: 0, y: 0 } } as cytoscape.LayoutOptions
        : { name: "cose", animate: false, nodeRepulsion: () => 14000, idealEdgeLength: () => 90, padding: 40 } as cytoscape.LayoutOptions,
    });
    const fresh = c.nodes().filter((n) => !positions.has(n.id()));
    if (positions.size && fresh.length) {
      fresh.forEach((n) => {
        const nb = n.neighborhood("node").filter((m) => positions.has(m.id()));
        const p = nb.length ? nb[0].position() : { x: 0, y: 0 };
        n.position({ x: p.x + (Math.random() - 0.5) * 160, y: p.y + (Math.random() - 0.5) * 160 });
      });
      c.layout({ name: "cose", animate: true, animationDuration: 500, fit: false, randomize: false, nodeRepulsion: () => 14000, idealEdgeLength: () => 90 } as cytoscape.LayoutOptions).run();
    }
    c.on("tap", "node", (ev) => setSel(g.nodes.find((n) => n.id === ev.target.id()) ?? null));
    c.on("tap", "edge", (ev) => setSel(g.edges.find((e) => e.id === ev.target.id()) ?? null));
    c.on("tap", (ev) => { if (ev.target === c) setSel(null); });
    c.on("dbltap", "node", (ev) => expand(ev.target.id()));
    cy.current = c;
    applyFollow(c, follow);
    return undefined;
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { cy.current?.destroy(); cy.current = null; }, []);
  useEffect(() => { if (cy.current) applyFollow(cy.current, follow); }, [follow]);

  function applyFollow(c: Core, on: boolean) {
    c.elements().removeClass("dim flow");
    if (!on) return;
    const money = c.edges("[type = 'SENDS_MONEY_TO'], [type = 'SETTLES'], [type = 'BILLED'], [type = 'PAID_INTO']");
    c.elements().addClass("dim");
    money.removeClass("dim").addClass("flow");
    money.connectedNodes().removeClass("dim");
  }

  function expand(id: string) {
    if (!g) return;
    setVisible((v) => new Set([...v, ...neighbours(g, new Set([id]), 1, false)]));
  }

  function search(text: string) {
    setQ(text);
    const c = cy.current;
    if (!c || !g) return;
    c.nodes().removeClass("hit");
    if (text.trim().length < 2) return;
    const t = text.toLowerCase();
    const hits = g.nodes.filter((n) => n.label.toLowerCase().includes(t) || n.id.toLowerCase().includes(t));
    const missing = hits.filter((h) => !visible.has(h.id)).map((h) => h.id);
    if (missing.length && missing.length < 6) setVisible((v) => new Set([...v, ...missing]));
    const els = c.nodes().filter((n) => hits.some((h) => h.id === n.id()));
    els.addClass("hit");
    if (els.length) c.animate({ fit: { eles: els, padding: 120 } }, { duration: 400 });
  }

  if (!g) return <div className="nx nx-loading">Loading the network…</div>;

  const typeCounts = new Map<string, number>();
  g.nodes.filter((n) => visible.has(n.id)).forEach((n) => typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1));
  const edgeCounts = new Map<string, number>();
  g.edges.filter((e) => visible.has(e.source) && visible.has(e.target)).forEach((e) => edgeCounts.set(e.type, (edgeCounts.get(e.type) ?? 0) + 1));
  const amounts = g.edges.filter((e) => e.amount && visible.has(e.source) && visible.has(e.target)).map((e) => e.amount!);
  const maxB = Math.max(1000, ...amounts);
  const bins = Array.from({ length: 12 }, (_, i) => amounts.filter((a) => a >= (i * maxB) / 12 && a < ((i + 1) * maxB) / 12 + (i === 11 ? 1 : 0)).length);
  const binMax = Math.max(1, ...bins);
  const toggle = (set: Set<string>, k: string, fn: (s: Set<string>) => void) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); fn(n); };
  const isNode = sel && "label" in sel;

  return (
    <div className={`nx ${compact ? "nx-compact" : ""}`}>
      <div className="nx-canvas" ref={box} />
      <div className="nx-top">
        <div className="nx-tools">
          <button title="Zoom in" onClick={() => cy.current?.zoom({ level: (cy.current.zoom() ?? 1) * 1.25, renderedPosition: { x: (box.current?.clientWidth ?? 0) / 2, y: (box.current?.clientHeight ?? 0) / 2 } })}>＋</button>
          <button title="Zoom out" onClick={() => cy.current?.zoom({ level: (cy.current.zoom() ?? 1) / 1.25, renderedPosition: { x: (box.current?.clientWidth ?? 0) / 2, y: (box.current?.clientHeight ?? 0) / 2 } })}>－</button>
          <button title="Fit to screen" onClick={() => cy.current?.animate({ fit: { eles: cy.current.elements(), padding: 40 } }, { duration: 300 })}>⤢</button>
          <button title="Re-arrange" onClick={() => cy.current?.layout({ name: "cose", animate: true, animationDuration: 600, nodeRepulsion: () => 14000, idealEdgeLength: () => 90 } as cytoscape.LayoutOptions).run()}>⟳</button>
        </div>
        <input className="nx-search" placeholder="Search suppliers, bank accounts, people, invoices…" value={q} onChange={(e) => search(e.target.value)} />
        <button className={`nx-follow ${follow ? "on" : ""}`} onClick={() => setFollow(!follow)} data-tour="follow">{follow ? "✓ Following the money" : "Follow the money"}</button>
        <button className="nx-ftoggle" onClick={() => setShowFilters(!showFilters)}>{showFilters ? "Hide filters" : "Filters"}</button>
      </div>

      {showFilters && (
        <aside className="nx-filters" data-tour="filters">
          <div className="nx-fhead"><h3>Filters</h3>
            <button className="linkbtn" onClick={() => { setOffTypes(new Set(["receipt"])); setOffEdges(new Set()); setBounds([0, Math.ceil(maxB / 1000) * 1000]); }}>Reset</button></div>
          <div className="nx-tabs">
            <button className={tab === "nodes" ? "on" : ""} onClick={() => setTab("nodes")}>Nodes</button>
            <button className={tab === "edges" ? "on" : ""} onClick={() => setTab("edges")}>Edges</button>
          </div>
          {tab === "nodes" ? (
            <ul className="nx-list">
              {[...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                <li key={t}><i style={{ background: TYPES[t]?.color }} /><span>{TYPES[t]?.label ?? t}</span><b>{n}</b>
                  <label className="sw"><input type="checkbox" checked={!offTypes.has(t)} onChange={() => toggle(offTypes, t, setOffTypes)} /><span /></label></li>
              ))}
            </ul>
          ) : (
            <>
              <ul className="nx-list">
                {[...edgeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                  <li key={t}><i className={RISKY_EDGES.has(t) ? "risky" : ""} /><span>{t.replaceAll("_", " ")}</span><b>{n}</b>
                    <label className="sw"><input type="checkbox" checked={!offEdges.has(t)} onChange={() => toggle(offEdges, t, setOffEdges)} /><span /></label></li>
                ))}
              </ul>
              <div className="nx-hist">
                <p>Amount on money edges</p>
                <div className="bars">{bins.map((b, i) => <span key={i} style={{ height: `${(100 * b) / binMax}%` }} title={`${b} edges`} />)}</div>
                <div className="nx-bounds">
                  <label>Lower bound<input type="number" value={bounds[0]} onChange={(e) => setBounds([Number(e.target.value), bounds[1]])} /></label>
                  <label>Upper bound<input type="number" value={bounds[1]} onChange={(e) => setBounds([bounds[0], Number(e.target.value)])} /></label>
                </div>
                <button className="linkbtn" onClick={() => setBounds([45000, 50000])}>Show only $45k to $50k (near the limit)</button>
              </div>
            </>
          )}
          <p className="fine">Double-click a node to expand its neighbours. Red rings are flagged by code; red dashed lines are risky links.</p>
        </aside>
      )}

      {sel && (
        <div className="nx-detail">
          <button className="x" onClick={() => setSel(null)}>×</button>
          {isNode ? (() => {
            const n = sel as GNode;
            return (<>
              <p className="kindtag" style={{ color: TYPES[n.type]?.color }}>{TYPES[n.type]?.label ?? n.type}</p>
              <h3>{n.label}</h3>
              {n.flags.length > 0 && <p>{n.flags.map((f) => <span key={f} className="nx-flag">{f}</span>)}</p>}
              <table className="fields"><tbody>
                {Object.entries(n.props).filter(([, v]) => v != null && v !== "").slice(0, 8).map(([k, v]) => (
                  <tr key={k}><th>{k.replaceAll("_", " ")}</th><td>{typeof v === "number" && ["amount", "limit", "value"].includes(k) ? usd(v) : String(v)}</td></tr>
                ))}
                <tr><th>connections</th><td>{n.degree}</td></tr>
              </tbody></table>
              <div className="nx-actions">
                <button onClick={() => expand(n.id)}>Expand neighbours</button>
                {n.type === "supplier" && onOpenSupplier && <button className="primary" onClick={() => onOpenSupplier(n.id)}>Open supplier page</button>}
              </div>
            </>);
          })() : (() => {
            const e = sel as GEdge;
            return (<>
              <p className="kindtag">Relationship</p>
              <h3>{e.type.replaceAll("_", " ")}</h3>
              <p className="mono small">{e.source} → {e.target}</p>
              {e.amount != null && <p><b>{usd(e.amount)}</b></p>}
              {e.note && <p className="fine">{e.note}</p>}
              {RISKY_EDGES.has(e.type) && <p className="nx-flag">flagged link</p>}
            </>);
          })()}
        </div>
      )}
      <div className="nx-status">{shown.nodes.length} nodes · {shown.edges.length} edges · scroll to zoom, drag to move</div>
    </div>
  );
}
