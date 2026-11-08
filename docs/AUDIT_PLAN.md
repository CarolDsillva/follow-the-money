# Audit brief: gap analysis and plan

Source: *ControlRoom Product Audit & Improvement Brief*. The brief is a checklist of risks to verify, not a list of observed bugs, because the reviewer couldn't run the app. Below, each requirement is checked against the code as of commit `904e95a`.

Written 8 Nov 2026, 11:00 UTC. The deadline is 23:00 UTC, so work stops by about 17:00 UTC to leave time for the video and submission.

## Already met (keep, and make visible in the demo)

| Brief requirement | Where it is today |
|---|---|
| Findings cite evidence; unsupported claims become hypotheses | Evidence validator rejects missing sources and excerpts; uncited "Confirmed" is downgraded; hypotheses have status labels |
| Exposure computed in code | `rules.exposure`, formula shown per invoice |
| Human approval of holds and supplier actions | LangGraph interrupt; approve or reject per action |
| Benign explanations tested | Challenge Agent; INC-0413 cleared by a code-verified contract |
| Remediation then rerun verification | Remediation steps add documents; closure checks rerun; close refused until they pass |
| Audit trail persisted | Events table in Postgres; signed report in Object Storage |
| Synthetic labels, masked accounts, no payment action | Banner, `****4821`, fixed action catalogue |
| Structured, validated agent output; deterministic arithmetic | JSON-schema tools plus validators; `rules.py` |
| Retry after a failure without losing state | Retry from checkpoint |
| Secrets out of the bundle and the repo | Server env files; secret scan before commit |

## Gaps, in the order they will be fixed

| # | Gap (brief section) | Change | Size |
|---|---|---|---|
| 1 | A finance user can't answer the seven questions at a glance (2A, P1 usability) | New **Overview** tab, first and default: what happened, why it was raised, how much, key evidence, what's unknown, the next step and who owns it. Built from case state, not new model text | M |
| 2 | Exposure is one headline number (2D) | Exposure split into number of invoices, pending payment, already paid, on hold, confirmed loss ("none established"), and what's included and excluded, each with source records | S |
| 3 | Action states aren't explicit enough (2E, must-fix 3) | Each action shows a lifecycle: Proposed → Approved or Rejected → Executed (simulated in the ERP) or Task open → Verified, plus an expected outcome and a due date, all from code | M |
| 4 | No event timeline (high impact, demo 0:55) | A code-built timeline: supplier creation, requests, approvals, POs, receipts, invoices, bank change, email, payment schedule, each with date, source ID and provenance | M |
| 5 | Evidence chips not all inspectable; map edges thin (2B, 3) | Clicking EV, CTL, LNK or a record opens an in-page evidence drawer (record fields, document excerpt, control result) instead of raw JSON; map edges show strength, status, rationale and their records | M |
| 6 | No role permissions on approvals and overrides (5) | Demo personas (AP Analyst, Finance Director, Internal Audit, Procurement, Warehouse), checked server-side: only the Finance Director approves actions or closes, only Internal Audit acknowledges, and only the Finance Director can override, with a reason. Labelled as demo personas, not authentication | M |
| 7 | Agent work not inspectable enough (2C, 5) | Each agent run records its run ID, model, prompt version (hash), inputs, output summary, duration and errors. Clicking an agent card shows its tool calls and handoff | M |
| 8 | Inbox lacks severity, age, owner, search (3) | Severity from code (exposure and open exceptions), owner, age, status filter and search | S |
| 9 | History export only after closing (3) | **Export incident record** at any stage: JSON of state, events and decisions | S |
| — | **Cut line**: below here only if time is left | | |
| 10 | Request missing evidence (3) | A "Request" button on each unknown creates a tracked evidence request task | S |
| 11 | Docs, deck and demo script | Update for the above; redeploy; full live run of both incidents | S |

Each step ends with a type check, tests, a deploy to the VM and a live check before the next one starts.

## Second audit (screenshot-based): added items

That review saw a run partway through, so some of what it saw was simply not finished yet. The real problem is that the UI didn't *say* it wasn't finished. These are now in scope:

| # | Finding | Change |
|---|---|---|
| S1 | The map has no shared attributes before the Relationship Agent runs, so the "linked suppliers" headline looks unsupported | The graph shows the deterministic matcher's links from the start, labelled "found by matcher, awaiting assessment"; the agent's assessment upgrades them later |
| S2 | Agent states not truthful | Queued (with what it waits for), Running, Completed, Failed. "Agents working" names the running agent |
| S3 | Empty ledger and "Not yet challenged" look like finished features | Informative pending states that name the agent and its dependency. An Evidence Agent result with 0 accepted items fails the step (retryable) instead of passing silently |
| S4 | Threshold and grouping rule not shown | Trigger text and the Overview show the $50,000 limit (POL-01), the near-limit band (90 to 100%) and the grouping rule (same or linked supplier, same run) |
| S5 | ERP "approved for payment" confused with ControlRoom approval | Labelled "ERP status (business approval)" versus "ControlRoom decision" |
| S6 | Payment-run total versus incident exposure | Run card shows the value in open incidents versus the rest |
| S7 | Two incidents look alike; unclear button | Inbox shows the pattern (multi-supplier or single-supplier), severity, the next step, and "Start investigation" with an explanation of the isolated ERP snapshot |
| S8 | Verification page empty before running | Closure criteria listed as Pending from the start, with the evidence each needs |
| S9 | Trace not expandable | Click a trace line to see its inputs, outputs and source IDs |
| S10 | Status consistency and colour meaning | One status vocabulary with definitions; running in blue, attention in amber, success in green or teal; brighter small text |

## Status, 8 Nov 2026 ~12:00 UTC

Done and verified live on Vultr (scripts/live_full.py, scripts/live_benign.py): items 1 to 9 and S1 to S10, plus:
- An open approved task now blocks closure (`approved_tasks` check). The task's owner completes it with a note, and no other persona can.
- An empty evidence ledger blocks the step (one automatic retry first); Retry from checkpoint resumes it.
- Resolution actions targeting records outside the incident are removed and logged.
- Page shell served `no-cache`; the font policy fixed.

Not done (below the cut line): item 10, "request missing evidence" as a tracked task.
