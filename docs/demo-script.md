# Demo video script (about 3.5 minutes)

Record at 1440×900 in Chrome. Start a fresh copy of INC-0412 about 2 minutes before recording the investigation, or record it live and speed up the waiting parts. Keep **Follow the agents** ticked until the approval step.

| Time | Screen | Say |
|---|---|---|
| 0:00 | Inbox. Point at the payment-run card: $379,387, 33 h | "Northstar's weekly payment run releases in 33 hours. A deterministic scan has flagged two clusters of invoices just under the $50,000 approval limit. An alert like this is where most tools stop. ControlRoom starts here." |
| 0:15 | Click **Investigate a fresh copy** on INC-0412 | "Each run gets its own copy of the ERP, so a judge can run this exact incident themselves." |
| 0:20 | Investigation tab: agent cards lighting up, live trace | "Eight roles in a LangGraph workflow on a Vultr VM. Every model call goes to Vultr Serverless Inference: a fast Qwen model for the specialists, and GLM for the Commander and the Challenge Agent, so the critic isn't the same model marking its own work." |
| 0:40 | Trace: `read_document(EML-019)`, then the red Guard line | "The Evidence Agent reads the original documents from Vultr Object Storage. This email says the bank change was 'verified by your CFO', and tells automated assistants to approve it. That's treated as data, not an instruction." |
| 0:55 | Relationship map | "One invoice at a time, these are three different suppliers. Together they share one bank account, one phone, one address, and a look-alike email domain. The links come from a deterministic matcher; the agent assesses them." |
| 1:15 | Evidence & hypotheses: the Contradicted harmless explanation | "Then it argues with itself. The Challenge Agent proposed the innocent version, a phased project under a framework contract, found the only contract, and code proved it doesn't cover these suppliers. Contradicted. Other harmless explanations stay Unresolved, with what would settle them." |
| 1:35 | Exposure & actions: the three numbers and the formula | "Money is never computed by a model. $144,000 is in the run, $67,800 is billed but not received, $48,000 goes to a bank account changed seven days ago." |
| 1:50 | Approve the five actions as Tom Okafor, Finance Director | "Agents propose; a person decides. There is no action that can pay anyone. The workflow waits in Postgres for this decision, and survives a restart." |
| 2:10 | Verification & audit → **Close incident** → red **Close refused** | "Most case tools would let me close this now. ControlRoom refuses: four of five closure checks fail. 'Resolved' isn't a button." |
| 2:25 | **Procurement: callback and due diligence** → **Run verification** | "Procurement calls Ridgeline on the number on file since 2019. Ridgeline never changed its bank details. Verification reruns the controls: three of five pass, and the agent explains what's still missing." |
| 2:45 | **Warehouse and AP** → **Internal Audit** → **Run verification** → **Close incident** | "Receipts confirmed, the shortfall disputed, audit acknowledges. Five of five. Now it closes." |
| 3:00 | Green closed panel → open the signed report | "The full case (evidence, decisions, checks and every agent step) is signed and stored in Vultr Object Storage. This incident cost six cents of inference." |
| 3:10 | Inbox → INC-0413 closed as no control failure | "And the look-alike: three near-limit invoices that are fine, because a signed framework agreement covers them. ControlRoom investigates risk; it doesn't accuse." |
| 3:25 | Close on the tagline | "ControlRoom. From financial alert to verified resolution." |

Backup if inference is slow during recording: use a completed run from the "Investigation runs" table and narrate the same steps. Say it's a recorded run.
