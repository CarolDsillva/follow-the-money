import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { get } from "./api";

// ------------------------------------------------------------------ demo personas

export const PERSONAS: Record<string, { name: string; role: string }> = {
  ap_lead: { name: "Elena Brandt", role: "AP Operations Lead" },
  finance_director: { name: "Tom Okafor", role: "Finance Director" },
  internal_audit: { name: "Rafael Moreno", role: "Internal Audit Manager" },
  procurement: { name: "Grace Liu", role: "Procurement Lead" },
  warehouse: { name: "Ana Petrov", role: "Warehouse Supervisor" },
};

// Mirrors the server's rules so buttons can explain themselves. The API enforces them.
export const ALLOWED: Record<string, string> = {
  decide: "finance_director", close: "finance_director", override: "finance_director",
  audit_ack: "internal_audit", "remediation:callback": "procurement", "remediation:receiving": "warehouse",
};

type PersonaCtx = { persona: string; setPersona: (p: string) => void; can: (perm: string) => boolean; needs: (perm: string) => string };
const Persona = createContext<PersonaCtx>(null!);

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, set] = useState(() => localStorage.getItem("persona") ?? "ap_lead");
  const setPersona = (p: string) => { localStorage.setItem("persona", p); set(p); };
  const can = (perm: string) => ALLOWED[perm] === persona;
  const needs = (perm: string) => `Needs the ${PERSONAS[ALLOWED[perm]].role} (${PERSONAS[ALLOWED[perm]].name}). Switch persona at the top right.`;
  return <Persona.Provider value={{ persona, setPersona, can, needs }}>{children}</Persona.Provider>;
}

export const usePersona = () => useContext(Persona);

export function PersonaSwitch() {
  const { persona, setPersona } = usePersona();
  return (
    <label className="persona" title="Demo personas, not authentication. The API enforces what each role may do.">
      <span>Acting as</span>
      <select value={persona} onChange={(e) => setPersona(e.target.value)}>
        {Object.entries(PERSONAS).map(([k, p]) => <option key={k} value={k}>{p.name} · {p.role}</option>)}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ evidence drawer

type Hit = { kind: string; title: string; label?: string; excerpt?: string; fields?: Record<string, unknown>; records?: string[]; note?: string; open?: string; source_id?: string };
type DrawerCtx = { open: (ref: string) => void };
const Drawer = createContext<DrawerCtx>({ open: () => {} });
export const useDrawer = () => useContext(Drawer);

export function DrawerProvider({ caseId, children }: { caseId: string; children: ReactNode }) {
  const [stack, setStack] = useState<string[]>([]);
  const [hit, setHit] = useState<Hit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = stack[stack.length - 1];

  useEffect(() => {
    if (!ref) return;
    setHit(null); setErr(null);
    get<Hit>(`/api/cases/${caseId}/lookup/${encodeURIComponent(ref)}`).then(setHit).catch((e) => setErr(e.message));
  }, [ref, caseId]);

  const open = (r: string) => setStack((s) => [...s, r]);
  return (
    <Drawer.Provider value={{ open }}>
      {children}
      {ref && (
        <aside className="drawer" role="dialog" aria-label={`Evidence ${ref}`}>
          <div className="drawer-head">
            {stack.length > 1 && <button className="linkbtn" onClick={() => setStack((s) => s.slice(0, -1))}>← Back</button>}
            <span className="chip">{ref}</span>
            <button className="x" onClick={() => setStack([])} aria-label="Close">×</button>
          </div>
          {err && <p className="error">{err}</p>}
          {!hit && !err && <p className="muted">Loading</p>}
          {hit && (
            <div className="drawer-body">
              <p className="kindtag">{hit.kind.replaceAll("_", " ")}{hit.label ? ` · ${hit.label}` : ""}</p>
              <h3>{hit.title}</h3>
              {hit.excerpt && <blockquote className="big">{hit.excerpt}</blockquote>}
              {hit.fields && (
                <table className="fields"><tbody>
                  {Object.entries(hit.fields).map(([k, v]) => (
                    <tr key={k}><th>{k.replaceAll("_", " ")}</th><td>{typeof v === "object" ? JSON.stringify(v) : String(v ?? "–")}</td></tr>
                  ))}
                </tbody></table>
              )}
              {hit.note && <p className="fine">{hit.note}</p>}
              {hit.open && <a className="button" href={hit.open} target="_blank" rel="noreferrer">Open the original</a>}
              {hit.records && hit.records.length > 0 && (
                <p className="fine">Sources: {hit.records.map((r) => <button key={r} className="chip chipbtn" onClick={() => open(r)}>{r}</button>)}</p>
              )}
            </div>
          )}
        </aside>
      )}
    </Drawer.Provider>
  );
}

export function Cite({ id }: { id: string }) {
  const { open } = useDrawer();
  return <button className="chip chipbtn" onClick={() => open(id)} title="Show the evidence">{id}</button>;
}
