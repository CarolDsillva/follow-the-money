import { useEffect, useLayoutEffect, useState } from "react";

export type TourStep = { target: string; title: string; body: string; tab?: string };

type Rect = { top: number; left: number; width: number; height: number };

export function Tour({ steps, storageKey, onTab, autoStart }: { steps: TourStep[]; storageKey: string; onTab: (tab: string) => void; autoStart: boolean }) {
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (autoStart && !sessionStorage.getItem(storageKey)) setI(0);
  }, [autoStart, storageKey]);

  const step = i == null ? null : steps[i];

  useEffect(() => { if (step?.tab) onTab(step.tab); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!step) return;
    let tries = 0;
    let timer = 0;
    const measure = () => {
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (!el) {
        if (tries++ < 20) timer = window.setTimeout(measure, 150);
        else setRect(null);
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 });
      }, 350);
    };
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", onResize); };
  }, [step]);

  const close = () => { sessionStorage.setItem(storageKey, "done"); setI(null); };

  if (i == null || !step) {
    return <button className="tour-hint" onClick={() => setI(0)}>? Product tour</button>;
  }
  const big = rect ? rect.height > window.innerHeight * 0.55 : false;
  const below = rect ? rect.top + rect.height + 220 < window.innerHeight : true;
  const cardTop = !rect ? window.innerHeight / 2 - 100 : big ? window.innerHeight - 250 : below ? rect.top + rect.height + 12 : Math.max(12, rect.top - 230);
  const cardLeft = !rect ? window.innerWidth / 2 - 180 : big ? 24 : Math.min(Math.max(12, rect.left), window.innerWidth - 380);
  return (
    <>
      {rect ? <div className="tour-shade" style={rect} /> : <div className="tour-shade" style={{ top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 }} />}
      <div className="tour-card" style={{ top: cardTop, left: cardLeft }} role="dialog" aria-label={step.title}>
        <span className="tstep">Product tour · {i + 1} of {steps.length}</span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="trow">
          <div className="dots">{steps.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>
          <span className="grow" />
          <button className="linkbtn" onClick={close}>Skip</button>
          {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
          <button className="primary" onClick={() => (i + 1 < steps.length ? setI(i + 1) : close())}>{i + 1 < steps.length ? "Next" : "Start exploring"}</button>
        </div>
      </div>
    </>
  );
}

export const CASE_TOUR: TourStep[] = [
  { target: "[data-tour=stepper]", title: "One incident, six stages", body: "Every case moves from Detected to Verified & closed. Right now the AI agents are investigating; you'll approve and verify later.", tab: "Overview" },
  { target: "[data-tour=kpis]", title: "What's at stake", body: "Potential exposure is calculated by code, never by the AI. The payment run releases in 33 hours, and the model cost of this whole investigation is shown live.", tab: "Overview" },
  { target: "[data-tour=agents]", title: "Eight specialists at work", body: "Each card is one agent with one job. Click a card to see exactly what it was given, which tools it called and what it returned.", tab: "Investigation" },
  { target: "[data-tour=network]", title: "Follow the money", body: "Three suppliers that look unrelated share one bank account. Drag, zoom, double-click to expand, and press Follow the money to light up where payments go.", tab: "Network graph" },
  { target: "[data-tour=overview]", title: "The answer, in plain English", body: "What happened, why it was raised, how much, the evidence, the competing explanations and who acts next. Click any ID to see its source.", tab: "Overview" },
  { target: "[data-tour=persona]", title: "You play every role", body: "Approvals need the Finance Director, fixes need each team. Switch persona here. Try approving as the AP lead first: the system will refuse.", tab: "Overview" },
  { target: "[data-tour=guide]", title: "Your next step, always", body: "This strip tells you what to do next and switches persona for you. Follow it to the end: approve, get refused at close, fix, verify, close.", tab: "Overview" },
];
