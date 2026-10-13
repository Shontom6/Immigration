"""Reads ISD + DETE processing-date pages and writes dates.json. Fails loudly if anything is missing."""
import json, re, sys, datetime as dt
import requests
from bs4 import BeautifulSoup

ISD = "https://www.irishimmigration.ie/registering-your-immigration-permission/how-to-renew-your-current-permission/renewing-your-registration-permission-if-you-live-in-the-republic-of-ireland/"
DETE = "https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/current-application-processing-dates/"
HDR = {"User-Agent": "irp-tracker/1.0 (personal project; once-daily check)"}

def soup(url):
    r = requests.get(url, headers=HDR, timeout=30); r.raise_for_status()
    return BeautifulSoup(r.text, "html.parser")

def fail(msg):
    print("SCRAPE FAILED:", msg, file=sys.stderr); sys.exit(1)

def isd():
    s = soup(ISD); text = s.get_text(" ", strip=True)
    m = re.search(r"last updated on (\w+ \d{1,2}, \d{4})", text)
    if not m: fail("ISD 'last updated' not found")
    pub = dt.datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat()
    want = ["1, 1H", "1G", "2, 2A, 1A", "4", "All other categories"]
    got = {}
    for tr in s.find_all("tr"):
        c = [x.get_text(" ", strip=True) for x in tr.find_all(["td", "th"])]
        if len(c) >= 2 and c[0] in want and re.match(r"\d\d/\d\d/\d\d", c[1]):
            d, mo, y = c[1][:8].split("/")
            got[c[0]] = f"20{y}-{mo}-{d}"
    if len(got) != 5: fail(f"ISD rows found: {got}")
    return {"pub": pub, "items": [got[k] for k in want]}

def dete():
    s = soup(DETE); text = s.get_text(" ", strip=True)
    m = re.search(r"As of (\d{1,2} \w+ \d{4})", text)
    if not m: fail("DETE 'As of' date not found")
    pub = dt.datetime.strptime(m.group(1), "%d %B %Y").date().isoformat()
    keys = [  # same order as the website; first match wins, so ICT is tested before plain Renewal
        ("Intra-Company Transfer", "(Renewal)", 5), ("Intra-Company Transfer", "(New)", 4),
        ("Renewal Applications", "", 0), ("Critical Skills", "", 1),
        ("New General Employment", "", 2), ("All other New", "", 3), ("Reviews", "", 6)]
    out = [None] * 7
    for t in s.find_all("table"):
        rows = [r.get_text(" ", strip=True) for r in t.find_all("tr")]
        if len(rows) < 2: continue
        for a, b, i in keys:
            if a in rows[0] and b in rows[0]:
                out[i] = dt.datetime.strptime(rows[1].strip(), "%d %B %Y").date().isoformat(); break
    if None in out: fail(f"DETE tables found: {out}")
    return {"pub": pub, "items": out}

data = {"checked": dt.date.today().isoformat(), "isd": isd(), "dete": dete()}
json.dump(data, open("dates.json", "w"), indent=2)
print(json.dumps(data, indent=2))
