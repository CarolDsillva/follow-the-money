import { useEffect, useMemo, useState } from "react";
import { get, usd } from "./api";

type Sup = { id: string; name: string; in_run: number; payments: number; bank: string; new: boolean; bank_changed: boolean;
  incident: { id: string; title: string; severity: string; exposure: number } | null };
type Net = { run: { id: string; name: string; total: number; payments: number; scheduled_for: string }; suppliers: Sup[];
  links: { from: string; to: string; attribute: string; strength: string; explanation: string }[];
  incidents: { id: string; title: string }[] };

const W = 1400, H = 800;
const RUN = { x: 560, y: 360 };
const ORBITS = [{ rx: 230, ry: 175 }, { rx: 380, ry: 250 }, { rx: 540, ry: 320 }];

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

export function MoneyMap({ net, onPick }: { net: Net | null; onPick: (caseId: string) => void }) {
  const [hover, setHover] = useState<(Sup & { x: number; y: number }) | null>(null);

  const placed = useMemo(() => {
    if (!net) return [];
    const inc = net.suppliers.filter((s) => s.incident);
    const paid = net.suppliers.filter((s) => !s.incident && s.in_run > 0);
    const idle = net.suppliers.filter((s) => !s.incident && s.in_run === 0);
    const out: (Sup & { x: number; y: number; o: number; label?: boolean })[] = [];
    const linked = inc.filter((s) => s.incident!.id === "INC-0412");
    const single = inc.filter((s) => s.incident!.id !== "INC-0412");
    linked.forEach((s, i) => out.push({ ...s, ...at(0, -128 + i * 38), o: 0, label: true }));
    single.forEach((s, i) => out.push({ ...s, ...at(0, 70 + i * 30), o: 0, label: true }));
    const top = [...paid].sort((a, b) => b.in_run - a.in_run);
    const big = top.slice(0, 6), rest = top.slice(6);
    big.forEach((s, i) => out.push({ ...s, ...at(1, -48 + i * (96 / Math.max(1, big.length - 1))), o: 1, label: true } as never));
    rest.forEach((s, i) => {
      const a = -150 + i * (300 / Math.max(1, rest.length - 1));
      out.push({ ...s, ...at(2, Math.abs(a) < 12 ? a + 14 : a), o: 2 });
    });
    idle.forEach((s, i) => out.push({ ...s, ...at(2, -165 + i * (330 / Math.max(1, idle.length - 1)) + 4), o: 2 }));
    return out;
  }, [net]);

  const pos = Object.fromEntries(placed.map((p) => [p.id, p]));
  const max = Math.max(1, ...placed.map((p) => p.in_run));

  return (
    <svg className="mm" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img"
      aria-label="Money flow: every supplier due in the next payment run, with incidents highlighted">
      <defs>
        <linearGradient id="flow" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.15" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="flowRisk" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="#fb7185" stopOpacity="0.25" />
          <stop offset="1" stopColor="#fecdd3" stopOpacity="1" />
        </linearGradient>
        <radialGradient id="core"><stop offset="0" stopColor="#ffffff" /><stop offset="0.35" stopColor="#e0f2fe" stopOpacity="0.9" /><stop offset="1" stopColor="#38bdf8" stopOpacity="0" /></radialGradient>
        <radialGradient id="risk"><stop offset="0" stopColor="#fb7185" stopOpacity="0.85" /><stop offset="1" stopColor="#fb7185" stopOpacity="0" /></radialGradient>
      </defs>

      {ORBITS.map((o, i) => (
        <ellipse key={i} cx={RUN.x + o.rx} cy={RUN.y} rx={o.rx} ry={o.ry} fill="none" stroke="#ffffff" strokeOpacity={0.16 - i * 0.03} strokeWidth="1.2" />
      ))}

      {placed.filter((p) => p.in_run > 0).map((p) => {
        const d = `M${p.x},${p.y} C${p.x - 160},${p.y} ${RUN.x + 140},${RUN.y} ${RUN.x},${RUN.y}`;
        const w = 1.2 + (9 * p.in_run) / max;
        return (
          <g key={`f-${p.id}`}>
            <path d={d} fill="none" stroke={p.incident ? "url(#flowRisk)" : "url(#flow)"} strokeWidth={w} strokeLinecap="round" opacity={p.incident ? 0.95 : p.label ? 0.6 : 0.28} />
            {(p.incident || p.label) && <path d={d} fill="none" stroke="#ffffff" strokeWidth={Math.max(1, w / 3)} strokeDasharray="2 14" className="mm-dash" opacity="0.8" />}
          </g>
        );
      })}

      {net?.links.filter((l) => l.strength !== "weak" && pos[l.from] && pos[l.to]).map((l, i) => {
        const a = pos[l.from], b = pos[l.to];
        const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 60;
        return <path key={`l-${i}`} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} fill="none" stroke="#fb7185" strokeWidth="1.6" strokeDasharray="5 5" opacity="0.9">
          <title>{l.from} and {l.to}: {l.explanation}</title></path>;
      })}

      <circle cx={RUN.x} cy={RUN.y} r="70" fill="url(#core)" className="mm-pulse" />
      <circle cx={RUN.x} cy={RUN.y} r="11" fill="#ffffff" />
      <circle cx={RUN.x - 52} cy={RUN.y} r="9" fill="none" stroke="#ffffff" strokeOpacity="0.5" />
      <circle cx={RUN.x - 52} cy={RUN.y} r="3.5" fill="#ffffff" />
      {net && (
        <g className="mm-runlabel">
          <text x={RUN.x - 28} y={RUN.y - 40} textAnchor="end">{net.run.id}</text>
          <text x={RUN.x - 28} y={RUN.y - 18} textAnchor="end" className="big">{usd(net.run.total)}</text>
        </g>
      )}

      {placed.map((p) => {
        const r = p.incident ? 9 : p.label ? 6 : p.in_run > 0 ? 4 : 3;
        return (
          <g key={p.id} className={`mm-node ${p.incident ? "risk" : p.in_run > 0 ? "paid" : "idle"}`}
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
            onClick={() => (p.incident ? onPick(p.incident.id) : (location.href = `/?supplier=${p.id}`))} style={{ cursor: "pointer" }}>
            {p.incident && <circle cx={p.x} cy={p.y} r="30" fill="url(#risk)" className="mm-pulse" />}
            <circle cx={p.x} cy={p.y} r={r} />
            {p.label && (() => {
              const left = p.x > 1150;
              const x = left ? p.x - 14 : p.x + 14;
              return (
                <text x={x} y={p.y - 2} textAnchor={left ? "end" : "start"}>
                  <tspan x={x}>{p.name.split(" ").slice(0, 2).join(" ")}</tspan>
                  <tspan x={x} dy="17" className="amt">{usd(p.in_run)}</tspan>
                </text>
              );
            })()}
          </g>
        );
      })}

      {placed.filter((p) => p.incident).length > 0 && (() => {
        const groups: Record<string, typeof placed> = {};
        placed.filter((p) => p.incident).forEach((p) => (groups[p.incident!.id] ??= []).push(p));
        return Object.entries(groups).map(([id, ps]) => {
          const above = ps[0].y < RUN.y;
          const x = Math.min(...ps.map((p) => p.x)) - 10;
          const y = above ? Math.min(...ps.map((p) => p.y)) - 70 : Math.max(...ps.map((p) => p.y)) + 70;
          const inc = ps[0].incident!;
          return (
            <g key={id} className="mm-tag" onClick={() => onPick(id)}>
              <rect x={x - 6} y={y - 24} width="232" height="48" rx="10" />
              <text x={x + 8} y={y - 4} className="t1">{id} · {inc.severity} risk</text>
              <text x={x + 8} y={y + 14} className="t2">{usd(inc.exposure)} potential exposure →</text>
            </g>
          );
        });
      })()}

      {hover && (
        <g className="mm-tip" transform={`translate(${Math.min(hover.x + 16, W - 330)},${hover.y + 18})`}>
          <rect width="330" height="92" rx="10" />
          <text x="14" y="24" className="t1">{hover.name}</text>
          <text x="14" y="44">{hover.payments} payment{hover.payments === 1 ? "" : "s"} · {usd(hover.in_run)} in this run · bank {hover.bank}</text>
          <text x="14" y="62">{[hover.new && "new supplier", hover.bank_changed && "bank changed, no callback"].filter(Boolean).join(" · ") || "no flags"}</text>
          <text x="14" y={hover.incident ? 82 : 62 + 20} className="t3">{hover.incident ? `In ${hover.incident.id}: click to open the incident` : "Click to open its supplier page"}</text>
        </g>
      )}
    </svg>
  );
}
