import { useEffect, useMemo, useState } from "react";
import { get, usd } from "./api";

type Sup = { id: string; name: string; in_run: number; payments: number; bank: string; new: boolean; bank_changed: boolean;
  incident: { id: string; title: string; severity: string; exposure: number } | null };
type Net = { run: { id: string; name: string; total: number; payments: number; scheduled_for: string }; suppliers: Sup[];
  links: { from: string; to: string; attribute: string; strength: string; explanation: string }[];
  incidents: { id: string; title: string }[]; featured?: string[] };
type Placed = Sup & { x: number; y: number; kind: "risk" | "big" | "others"; count?: number };

const RUN = { x: 740, y: 430 };
const ORBITS = [{ rx: 185, ry: 175 }, { rx: 280, ry: 250 }, { rx: 320, ry: 300 }];

function at(orbit: number, deg: number) {
  const o = ORBITS[orbit];
  const t = (deg * Math.PI) / 180;
  return { x: RUN.x + o.rx + o.rx * Math.cos(t), y: RUN.y + o.ry * Math.sin(t) };
}

export function useNetwork() {
  const [net, setNet] = useState<Net | null>(null);
  useEffect(() => { get<Net>("/api/network").then(setNet).catch(() => setNet(null)); }, []);
  return net;
}

/** A calm picture of one payment run: the run, the two incidents, the three biggest payees, and everyone else as one flow. */
export function MoneyMap({ net, onPick }: { net: Net | null; onPick: (caseId: string) => void }) {
  const [hover, setHover] = useState<Placed | null>(null);

  const placed = useMemo<Placed[]>(() => {
    if (!net) return [];
    const out: Placed[] = [];
    const linked = net.suppliers.filter((s) => s.incident?.id === "INC-0412");
    const single = net.suppliers.filter((s) => s.incident && s.incident.id !== "INC-0412");
    linked.forEach((s, i) => out.push({ ...s, ...at(0, -132 + i * 40), kind: "risk" }));
    single.forEach((s, i) => out.push({ ...s, ...at(0, 96 + i * 30), kind: "risk" }));
    const paid = net.suppliers.filter((s) => !s.incident && s.in_run > 0).sort((a, b) => b.in_run - a.in_run);
    paid.slice(0, 3).forEach((s, i) => out.push({ ...s, ...at(1, -10 + i * 20), kind: "big" }));
    const rest = paid.slice(3);
    if (rest.length) {
      out.push({ id: "others", name: `${rest.length} other suppliers`, in_run: rest.reduce((a, s) => a + s.in_run, 0),
        payments: rest.reduce((a, s) => a + s.payments, 0), bank: "", new: false, bank_changed: false, incident: null,
        ...at(1, 50), kind: "others", count: rest.length });
    }
    return out;
  }, [net]);

  const pos = Object.fromEntries(placed.map((p) => [p.id, p]));
  const max = Math.max(1, ...placed.map((p) => p.in_run));

  return (
    <svg className="mm" viewBox="610 110 730 620" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Money flow: the next payment run, the two incidents in red, and the biggest payees">
      <defs>
        <linearGradient id="flow" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.2" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="flowRisk" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="#fb7185" stopOpacity="0.3" />
          <stop offset="1" stopColor="#fecdd3" stopOpacity="1" />
        </linearGradient>
        <radialGradient id="core"><stop offset="0" stopColor="#ffffff" /><stop offset="0.35" stopColor="#e0f2fe" stopOpacity="0.9" /><stop offset="1" stopColor="#38bdf8" stopOpacity="0" /></radialGradient>
        <radialGradient id="risk"><stop offset="0" stopColor="#fb7185" stopOpacity="0.85" /><stop offset="1" stopColor="#fb7185" stopOpacity="0" /></radialGradient>
      </defs>

      {ORBITS.slice(0, 2).map((o, i) => (
        <ellipse key={i} cx={RUN.x + o.rx} cy={RUN.y} rx={o.rx} ry={o.ry} fill="none" stroke="#ffffff" strokeOpacity={0.18 - i * 0.05} strokeWidth="1.2" />
      ))}

      {placed.map((p) => {
        const d = `M${p.x},${p.y} C${p.x - 170},${p.y} ${RUN.x + 150},${RUN.y} ${RUN.x},${RUN.y}`;
        const w = p.kind === "others" ? 14 : 2 + (7 * p.in_run) / max;
        return (
          <g key={`f-${p.id}`}>
            <path d={d} fill="none" stroke={p.kind === "risk" ? "url(#flowRisk)" : "url(#flow)"} strokeWidth={w} strokeLinecap="round"
              opacity={p.kind === "risk" ? 0.95 : p.kind === "others" ? 0.32 : 0.6} />
            <path d={d} fill="none" stroke="#ffffff" strokeWidth={Math.max(1, Math.min(3, w / 3))} strokeDasharray="2 14" className="mm-dash" opacity="0.75" />
          </g>
        );
      })}

      {net?.links.filter((l) => l.strength !== "weak" && pos[l.from] && pos[l.to]).map((l, i) => {
        const a = pos[l.from], b = pos[l.to];
        const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 50;
        return <path key={`l-${i}`} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} fill="none" stroke="#fb7185" strokeWidth="1.6" strokeDasharray="5 5" opacity="0.9">
          <title>{l.from} and {l.to}: {l.explanation}</title></path>;
      })}

      <circle cx={RUN.x} cy={RUN.y} r="74" fill="url(#core)" className="mm-pulse" />
      <circle cx={RUN.x} cy={RUN.y} r="12" fill="#ffffff" />
      {net && (
        <g className="mm-runlabel">
          <text x={RUN.x} y={RUN.y + 66} textAnchor="middle" className="big">{usd(net.run.total)}</text>
          <text x={RUN.x} y={RUN.y + 88} textAnchor="middle">due in {net.run.id}</text>
        </g>
      )}

      {placed.map((p) => {
        const r = p.kind === "risk" ? 9 : p.kind === "others" ? 12 : 6;
        const linkedIdx = placed.filter((q) => q.incident?.id === "INC-0412").findIndex((q) => q.id === p.id);
        const above = linkedIdx === 1;
        const left = p.x > 1120 || linkedIdx === 0;
        const below = p.kind === "others";
        const x = above || below ? p.x : left ? p.x - 16 : p.x + 16;
        return (
          <g key={p.id} className={`mm-node ${p.kind === "risk" ? "risk" : p.kind === "others" ? "others" : "paid"}`}
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
            onClick={() => (p.incident ? onPick(p.incident.id) : p.kind === "others" ? (location.href = "/?view=incidents") : (location.href = `/?supplier=${p.id}`))}
            style={{ cursor: "pointer" }}>
            {p.kind === "risk" && <circle cx={p.x} cy={p.y} r="30" fill="url(#risk)" className="mm-pulse" />}
            <circle cx={p.x} cy={p.y} r={r} />
            <text x={x} y={above ? p.y - 34 : below ? p.y + 36 : p.y - 2} textAnchor={above || below ? "middle" : left ? "end" : "start"}>
              <tspan x={x}>{p.kind === "others" ? p.name : p.name.split(" ").slice(0, 2).join(" ")}</tspan>
              <tspan x={x} dy="18" className="amt">{usd(p.in_run)}{p.kind === "others" ? " · no flags" : ""}</tspan>
            </text>
          </g>
        );
      })}

      {(() => {
        const groups: Record<string, Placed[]> = {};
        placed.filter((p) => p.incident).forEach((p) => (groups[p.incident!.id] ??= []).push(p));
        return Object.entries(groups).map(([id, ps]) => {
          const inc = ps[0].incident!;
          const up = ps[0].y < RUN.y;
          const x = Math.min(...ps.map((p) => p.x)) - 20;
          const y = up ? Math.min(...ps.map((p) => p.y)) - 92 : Math.max(...ps.map((p) => p.y)) + 70;
          return (
            <g key={id} className="mm-tag" onClick={() => onPick(id)}>
              <rect x={x - 8} y={y - 22} width="200" height="44" rx="10" />
              <text x={x + 6} y={y - 3} className="t1">{id} · {inc.severity}</text>
              <text x={x + 6} y={y + 14} className="t2">{usd(inc.exposure)} at risk →</text>
            </g>
          );
        });
      })()}

      {hover && (
        <g className="mm-tip" transform={`translate(${Math.min(hover.x + 16, 1000)},${Math.min(hover.y + 20, 650)})`}>
          <rect width="330" height="74" rx="10" />
          <text x="14" y="24" className="t1">{hover.name}</text>
          {hover.kind === "others" ? (
            <text x="14" y="46">{hover.payments} payments · {usd(hover.in_run)} · ordinary business, no flags</text>
          ) : (
            <text x="14" y="46">{usd(hover.in_run)} in this run{[hover.new && " · new supplier", hover.bank_changed && " · bank changed, no callback"].filter(Boolean).join("")}</text>
          )}
          <text x="14" y="64" className="t3">{hover.incident ? `In ${hover.incident.id}: click to open` : hover.kind === "others" ? "Click to see all incidents" : "Click to open the supplier"}</text>
        </g>
      )}
    </svg>
  );
}
