"""Screenshots 16-19 (harmless case, inbox, tour, live focus)."""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://followthemoney.137-220-32-178.sslip.io"
out = Path(sys.argv[1]); c413 = sys.argv[2]; live = sys.argv[3]
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1.5)
    page = ctx.new_page()
    page.add_init_script("localStorage.setItem('persona','finance_director');")
    page.goto(f"{BASE}/?case={c413}"); page.wait_for_selector(".casenet canvas", timeout=60000); time.sleep(3)
    page.get_by_role("tab", name="Evidence & hypotheses").click(); time.sleep(2.5)
    page.locator(".hyps").first.scroll_into_view_if_needed(); time.sleep(1)
    page.screenshot(path=str(out / "16-benign-hypotheses.png")); print("saved 16")
    page.goto(f"{BASE}/?view=incidents"); page.wait_for_selector(".table", timeout=60000); time.sleep(2)
    page.screenshot(path=str(out / "17-inbox.png")); print("saved 17")
    page.goto(f"{BASE}/?case={live}&guide=1"); page.wait_for_selector(".tour-card", timeout=60000); time.sleep(2.5)
    page.screenshot(path=str(out / "18-tour.png")); print("saved 18")
    page.get_by_role("button", name="Skip").click(); time.sleep(1)
    page.locator(".casenet").scroll_into_view_if_needed(); time.sleep(4)
    page.locator(".casenet").screenshot(path=str(out / "19-live-focus.png")); print("saved 19")
    b.close()
