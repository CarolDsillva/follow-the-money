"""Crisp screenshots of the newest screens for the deck (2x)."""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

B = "https://followthemoney.137-220-32-178.sslip.io"
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
CLOSED, AWAIT, STUCK = "INC-0412-D650", "INC-0412-C55F", "INC-0412-8AC7"


def ctx(b, persona="finance_director", hide=True):
    c = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    c.add_init_script(f"localStorage.setItem('persona','{persona}');" + ("sessionStorage.setItem('guide-hidden','1');" if hide else "")
                      + "document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');"
                      + "s.textContent='.topbar{position:static!important}' + (" + ("'.tour-hint{display:none!important}'" if hide else "''") + ");document.head.appendChild(s);});")
    return c.new_page()


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = ctx(b)
    pg.goto(B + "/"); pg.wait_for_selector(".mm-node.risk", timeout=60000); time.sleep(2.5)
    pg.screenshot(path=str(out / "hero.png")); print("hero")
    pg.locator("#cap").screenshot(path=str(out / "caps.png")); print("caps")

    pg.goto(f"{B}/?case={CLOSED}"); pg.wait_for_selector(".casenet canvas", timeout=60000); time.sleep(3)
    pg.screenshot(path=str(out / "case.png")); print("case")
    pg.locator(".casenet").screenshot(path=str(out / "network.png")); print("network")
    pg.locator(".plan").screenshot(path=str(out / "plan.png")); print("plan")
    pg.locator("[data-tour=agents]").screenshot(path=str(out / "agents.png")); print("agents")
    pg.get_by_role("tab", name="Overview").click(); time.sleep(1.5)
    pg.locator("[data-tour=overview]").screenshot(path=str(out / "overview.png")); print("overview")
    pg.get_by_role("tab", name="Verification & audit").click(); time.sleep(1.5)
    pg.locator(".grid2").first.screenshot(path=str(out / "verified.png")); print("verified")

    pa = ctx(b, "ap_lead")
    pa.goto(f"{B}/?case={AWAIT}&tab=Exposure%20%26%20actions"); pa.wait_for_selector(".approvebar", timeout=60000); time.sleep(2)
    pa.locator(".grid2").first.screenshot(path=str(out / "approve-locked.png")); print("approve-locked")

    pg.goto(f"{B}/?case={STUCK}&tab=Verification%20%26%20audit"); pg.wait_for_selector(".refused", timeout=60000); time.sleep(2)
    pg.locator(".refused").screenshot(path=str(out / "refused.png")); print("refused")

    pg.goto(f"{B}/?memo={CLOSED}"); pg.wait_for_selector(".memo-rec", timeout=60000); time.sleep(1.5)
    pg.locator(".memo").screenshot(path=str(out / "memo.png")); print("memo")

    pg.goto(f"{B}/?view=scan"); pg.wait_for_selector(".scan-hero")
    pg.get_by_role("button", name="Try it with the sample →").click(); pg.wait_for_selector(".fcard", timeout=60000); time.sleep(1.5)
    pg.locator(".fcard").first.click(); time.sleep(2.5)
    pg.locator("#scan-results").screenshot(path=str(out / "scan.png")); print("scan")

    pt = ctx(b, "ap_lead", hide=False)
    pt.goto(f"{B}/?case={CLOSED}&guide=1"); pt.wait_for_selector(".tour-card", timeout=60000)
    for _ in range(3):
        time.sleep(1.2); pt.locator(".tour-card button.primary").click()
    time.sleep(2)
    pt.screenshot(path=str(out / "tour.png")); print("tour")
    b.close()
