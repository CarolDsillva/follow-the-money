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
      if (!step.target) { setRect(null); return; }
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
  { target: "", title: "What you're looking at", tab: "Investigation",
    body: "Three invoices, $144,000, are about to be paid to suppliers that look unrelated. AI agents check whether they're connected. Here's how to read the screen." },
  { target: "[data-tour=stepper]", title: "Where the case is", tab: "Investigation",
    body: "Every case goes through six stages, from Detected to Verified & closed. The highlighted stage is where it is now. The AI does the first three; you take part in Approve, Remediate and Verify." },
  { target: "[data-tour=kpis]", title: "What's at stake", tab: "Investigation",
    body: "The money about to be paid, and how much of it isn't backed by deliveries. Code calculates these numbers, never the AI. Model cost is what this whole AI investigation cost, in cents." },
  { target: "[data-tour=network]", title: "The map of who is connected", tab: "Investigation",
    body: "Each circle is a supplier, bank account, person, invoice or payment. Red rings are flagged by the rules. While the agents work, whatever they're examining glows blue, with arrows. Look for one bank account linked to three suppliers." },
  { target: ".plan", title: "What the AI is trying to answer", tab: "Investigation",
    body: "Six plain questions, from 'Are these suppliers really separate companies?' to 'What should happen before the payment run?'. Each is ticked off when the agent responsible finishes." },
  { target: "[data-tour=agents]", title: "Who is doing the work", tab: "Investigation",
    body: "Eight specialists, each with one job. Blue means working, green means done. Click any card to see exactly what it read, which tools it used and what it concluded." },
  { target: "[data-tour=overview]", title: "The answer, in plain English", tab: "Overview",
    body: "When the agents finish, this page answers: what happened, why it was flagged, how much is at risk, the evidence, the innocent explanations tested, and who must act next. Click any ID to see its source." },
  { target: ".rolestrip", title: "You play the people", tab: "Investigation",
    body: "Real decisions need the right person. Switch persona at the top right; buttons your role can't use show a lock. Try approving as the AP lead first: the system refuses. Then switch to the Finance Director." },
  { target: "[data-tour=guide]", title: "Your next step, always", tab: "Investigation",
    body: "This strip tells you what to do next and can switch persona for you. Follow it to the end: approve, try to close and get refused, fix, verify, then close. That's the whole story." },
];
