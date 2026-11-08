# lablab.ai submission: copy and paste

Event: Vultr Agent Rush · Track: Challenge 2, Powering the Future of Work (Finance & Accounting)

## Project title

Follow the Money

## Tagline

Follow every dollar before it leaves.

## Short description (under 255 characters)

AI agents that catch connected fraud before the payment run: they link suppliers that share a bank account, argue the innocent side, let code do the math, and act only when a person approves. Built on Vultr.

## Long description (1754 characters, limit 600 to 2000)

Finance teams check invoices one at a time. Three invoices of $47k, $48k and $49k each sit under a $50k approval limit, are approved and come from suppliers on file, so $144,000 gets paid. Nobody sees in time that all three suppliers share one bank account, changed a week before the run, and that $67,800 of the goods never arrived.

Follow the Money checks the whole payment run before it pays. A code scan opens an incident, and a LangGraph workflow of seven AI agents investigates it: they read the invoices, receipts and emails, map shared bank accounts, phones and addresses, test policies, and propose actions. A Challenge Agent on a different model argues the innocent side. Code, never a model, calculates the exposure and decides every policy check. The incident page shows a live network graph that lights up whatever the agents are examining.

People stay in charge. Five roles are enforced by the API: only the Finance Director can approve actions or close a case. A case closes only when six checks pass in code, each failing check says how to fix it, and the result is an Ed25519-signed report. Every incident gets a one-page decision memo. A look-alike case is correctly cleared: it investigates, it doesn't accuse.

Built on Vultr: a Cloud Compute VM runs the FastAPI app and agents; Serverless Inference handles every model call (glm-5.3 for planning and the challenge, qwen3.8 for fast tool calls, with fallback); Managed PostgreSQL stores LangGraph checkpoints so a run pauses for a human decision and resumes; Object Storage holds the source documents and signed reports.

On the live demo: 108 payments worth $2.29M checked, $283,600 flagged across two incidents, about $0.08 per investigation, and zero payments the AI can release.

## Technologies

Vultr Cloud Compute · Vultr Serverless Inference (glm-5.3, qwen3.8-flash-next, qwen3.8-27b) · Vultr Managed PostgreSQL · Vultr Object Storage · LangGraph · FastAPI · Python · React · TypeScript · Cytoscape.js · Caddy · Ed25519 · Playwright

## Tags (if the form asks)

AI Agents · Finance · Accounts Payable · Fraud Detection · Human-in-the-loop · LangGraph · Vultr

## Links and files

| Field | Value |
|---|---|
| Live app | https://followthemoney.137-220-32-178.sslip.io |
| Source code | https://github.com/CarolDsillva/follow-the-money |
| Video | `docs/follow-the-money-demo.mp4` (1:58). Upload to YouTube (unlisted is fine) and paste the link |
| Slides | Export the "Follow the Money" deck as PDF and upload it |
| Cover image | `docs/cover.png` (1920×1080) |
| Finished examples | INC-0412-B559 (closed with a signed report) and INC-0413-7607 (look-alike, cleared) |

## Challenge 2 requirements (if the form asks)

- **Vultr VM backend:** yes, a Vultr Cloud Compute VM runs the backend and agents.
- **Web deployment:** yes, the app is served over HTTPS from the same VM via Caddy.
- **Serverless Inference (optional):** used for every model call.
- **GPUs:** not used.

## How judges can try it in three minutes

1. Open the live app and press **Run the live demo**. A short tour explains the screen while seven agents investigate live.
2. When the agents finish, open **Exposure & actions**. Try **Submit decisions** as the AP Lead: it's refused. Switch to Tom, the Finance Director, and approve.
3. On **Verification & audit**, press **Close incident**. It's refused, with a fix for each failing check. Follow the fixes, or open the finished example INC-0412-B559 to see a closed case and its decision memo.
