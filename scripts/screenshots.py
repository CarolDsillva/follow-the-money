"""Take product screenshots for the deck from the live site with a real browser.

  python scripts/screenshots.py OUT_DIR CLOSED_0412 CLOSED_0413 [LIVE_RUN]
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://followthemoney.137-220-32-178.sslip.io"
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
c412, c413 = sys.argv[2], sys.argv[3]
live = sys.argv[4] if len(sys.argv) > 4 else None


def shot(page, name, full=False, clip=None):
    path = out / f"{name}.png"
    page.screenshot(path=str(path), full_page=full, clip=clip)
    print("saved", path.name, flush=True)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1.5)
    page = ctx.new_page()
    page.add_init_script("sessionStorage.setItem('guide-hidden','1'); localStorage.setItem('persona','finance_director');")

    # landing
    page.goto(BASE + "/"); page.wait_for_selector(".mm-node.risk", timeout=60000); time.sleep(2.5)
    shot(page, "01-landing-hero")
    page.locator("#cap").scroll_into_view_if_needed(); time.sleep(0.8)
    shot(page, "02-landing-capabilities", clip={"x": 0, "y": page.locator("#cap").bounding_box()["y"] - 10, "width": 1440, "height": 900}) if False else None
    el = page.locator("#cap"); el.screenshot(path=str(out / "02-landing-capabilities.png")); print("saved 02")
    page.locator("#vultr").screenshot(path=str(out / "03-landing-vultr.png")); print("saved 03")

    # finished INC-0412 run
    def case(cid, tab=None, wait=".casenet canvas"):
        page.goto(f"{BASE}/?case={cid}"); page.wait_for_selector(wait, timeout=60000); time.sleep(3)
        if tab:
            page.get_by_role("tab", name=tab).click(); time.sleep(1.5)

    case(c412)
    shot(page, "04-case-top")
    page.get_by_role("tab", name="Investigation").click(); time.sleep(1)
    page.locator("[data-tour=agents]").screenshot(path=str(out / "05-agents.png")); print("saved 05")
    page.locator(".trace").screenshot(path=str(out / "06-trace.png")); print("saved 06")
    page.get_by_role("tab", name="Overview").click(); time.sleep(1.5)
    page.locator("[data-tour=overview]").screenshot(path=str(out / "07-overview.png")); print("saved 07")
    page.get_by_role("tab", name="Evidence & hypotheses").click(); time.sleep(1.5)
    page.locator(".grid2").first.screenshot(path=str(out / "08-evidence.png")); print("saved 08")
    page.get_by_role("tab", name="Exposure & actions").click(); time.sleep(1.5)
    page.locator(".grid2").first.screenshot(path=str(out / "09-exposure-actions.png")); print("saved 09")
    page.get_by_role("tab", name="Verification & audit").click(); time.sleep(1.5)
    page.locator(".grid2").first.screenshot(path=str(out / "10-verification.png")); print("saved 10")
    page.get_by_role("tab", name="Timeline").click(); time.sleep(2.5)
    page.locator(".timeline").first.screenshot(path=str(out / "11-timeline.png")); print("saved 11")
    page.locator(".casenet").screenshot(path=str(out / "12-case-network.png")); print("saved 12")
    page.locator(".nx-follow").click(); time.sleep(1.5)
    page.locator(".casenet").screenshot(path=str(out / "13-follow-the-money.png")); print("saved 13")

    # supplier page
    page.goto(f"{BASE}/?supplier=SUP-B"); page.wait_for_selector(".nx canvas", timeout=60000); time.sleep(3)
    shot(page, "14-supplier")

    # memo
    page.goto(f"{BASE}/?memo={c412}"); page.wait_for_selector(".memo-rec", timeout=60000); time.sleep(1.5)
    page.locator(".memo").screenshot(path=str(out / "15-memo.png")); print("saved 15")

    # harmless case
    case(c413, "Evidence & hypotheses")
    page.locator(".hyps").first.screenshot(path=str(out / "16-benign-hypotheses.png")); print("saved 16")

    # inbox
    page.goto(f"{BASE}/?view=incidents"); page.wait_for_selector(".table", timeout=60000); time.sleep(1.5)
    shot(page, "17-inbox")

    # live run with the tour and the network focus
    if live:
        page.add_init_script("sessionStorage.removeItem('guide-hidden');")
        page.goto(f"{BASE}/?case={live}&guide=1"); page.wait_for_selector(".tour-card", timeout=60000); time.sleep(2)
        shot(page, "18-tour")
        page.get_by_role("button", name="Skip").click(); time.sleep(1)
        for _ in range(30):
            if page.locator(".nx-now").count():
                break
            time.sleep(2)
        time.sleep(2)
        page.locator(".casenet").screenshot(path=str(out / "19-live-focus.png")); print("saved 19")
    b.close()
