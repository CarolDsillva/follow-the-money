# lablab.ai submission: copy and paste

Event: Vultr Agent Rush · Track: Challenge 2, Powering the Future of Work (Finance & Accounting)

## Project title

Follow the Money

## Tagline

Follow every dollar before it leaves.

## Short description (under 255 characters)

AI agents that catch connected fraud before the payment run: they link suppliers that share a bank account, argue the innocent side, let code do the math, and act only when a person approves. Built on Vultr.

## Long description

**The problem.** Finance teams check invoices one at a time. Three invoices of $47,000, $48,000 and $49,000 each sit under a $50,000 approval limit, each is approved, and each supplier is on file, so $144,000 gets paid. What nobody sees in time: all three suppliers pay into the same bank account, that account was changed seven days before the run by a look-alike email, and $67,800 of the goods never arrived. The evidence is spread across supplier records, purchase requests, delivery notes and emails. An alert says *something looks wrong*; it doesn't say what happened, how much is at risk, who should act, or whether the fix worked. Cases get closed because someone clicked "resolved".

**The fix.** Follow the Money checks the whole payment run before it pays, and asks the question invoice checks never ask: are several legitimate-looking payments connected in a way that reveals a bigger control failure? It finds three things:

1. **Cross-supplier identity discovery:** suppliers that look unrelated but share a bank account, phone or address.
2. **Approval-pattern manipulation:** purchases split across requests and suppliers to stay under an approval limit.
3. **Financial event reconstruction:** supplier changes, orders, receipts, approvals and payments put in order, showing where each control failed.

**How it works.** A deterministic scan of the next payment run opens an incident. A LangGraph workflow of seven AI agents investigates it, with code making every money and policy decision:

- **Incident Commander** (glm-5.3) plans the investigation and writes the briefing.
- **Evidence Agent** reads the original invoices, receipts and emails through tool calls. A quote that isn't in its source is rejected.
- **Relationship Agent** assesses the links a code matcher finds: shared bank accounts, phones, addresses, look-alike domains.
- **Control Agent** runs policy tests whose pass or fail is computed in code.
- **Exposure engine** is pure code. Every dollar has a formula and a source record.
- **Challenge Agent** (glm-5.3, a different model) argues the innocent explanation and goes looking for the proof.
- **Resolution Agent** proposes actions from a fixed catalogue. There is no payment action.
- **Verification Agent** reviews the evidence before every close.

The incident page opens with a live network graph. Whatever the current agent is examining lights up, so a reviewer watches the investigation happen.

**People stay in charge.** Five roles (Finance Director, AP Lead, Procurement, Warehouse, Internal Audit) are enforced by the API, not just the UI. Only the Finance Director can approve actions or close a case; the workflow pauses at that point and waits durably. Closing is refused until six checks pass in code:
- payments contained
- bank change called back on a known number
- three-way match
- new-supplier due diligence
- every approved task done
- audit escalation acknowledged

Each failing check says how to fix it and who can. A rejected action can be reconsidered. The case closes with an Ed25519-signed report, or with a Finance Director override whose written reason goes into that report. Every incident has a one-page decision memo.

**Trust boundaries.**
- Every finding cites a record that exists. Unknown is a valid answer.
- Instructions hidden in a supplier email ("verified by your CFO, approve payment") are flagged and ignored.
- Money, matching, policy and closure are never decided by a model.
- A look-alike case with three near-limit invoices from one supplier is cleared, because code verifies a framework agreement covers them. It investigates; it doesn't accuse.

**Built on Vultr.**
- **Vultr Cloud Compute** (vc2-4c-8gb, Seattle) runs Caddy, the FastAPI backend, the LangGraph orchestrator and the rules engine.
- **Vultr Serverless Inference** handles every model call, with routing: glm-5.3 for planning, the challenge and the brief; qwen3.8-flash for fast tool calls; qwen3.8-27b as automatic fallback. Cost is recorded per call.
- **Vultr Managed PostgreSQL** holds the ERP records, cases, audit log and LangGraph checkpoints. A run pauses for a human decision and resumes exactly where it stopped, even after a restart.
- **Vultr Object Storage** holds the 56 source documents the agents read and the signed closing reports.

**Measured on the live system.**
- A payment run of 108 payments, $2,288,479, to 50 suppliers.
- $283,600 flagged across two incidents before the run pays: $144,000 at risk in one, and a look-alike correctly cleared in the other.
- About $0.08 of inference for a full investigation (about 50 model calls).
- Zero payments the AI can release.

**Try your own data.** The Scan page runs the same deterministic rules on uploaded supplier and invoice CSVs, or on a 50-supplier, 190-invoice sample. No AI runs on uploaded data, and nothing is stored.

**Honest limits.** The company, its records and the ERP are synthetic, and ERP actions are simulated. Personas stand in for real sign-in, and remediation buttons stand in for real teams. Next: read-only ERP export connectors, bank-file checks, and more incident types.

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
