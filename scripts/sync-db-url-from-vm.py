#!/usr/bin/env python3
"""Update .env.local DATABASE_URL_PHASE1 from VM credential file (no stdout secrets)."""
import re
import subprocess
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"

r = subprocess.run(
    ["ssh", "-o", "BatchMode=yes", "nexloom-gce", "cat", "/home/2005nk/.risepath_db_pass"],
    capture_output=True,
    text=True,
    timeout=20,
)
password = (r.stdout or "").strip()
if r.returncode != 0 or len(password) < 16:
    raise SystemExit(f"failed to read VM password file: rc={r.returncode}")

user, host, port, dbname = "risepath_app", "nexloom-gce", "5432", "risepath"
url = f"postgresql://{user}:{urllib.parse.quote(password, safe='')}@{host}:{port}/{dbname}?sslmode=disable"

if ENV_PATH.exists():
    raw = ENV_PATH.read_text(encoding="utf-8")
else:
    raw = (ROOT / "env.local.template").read_text(encoding="utf-8")

if re.search(r"^DATABASE_URL_PHASE1=", raw, re.M):
    raw = re.sub(r"^DATABASE_URL_PHASE1=.*$", f"DATABASE_URL_PHASE1={url}", raw, count=1, flags=re.M)
else:
    raw = raw.rstrip() + f"\nDATABASE_URL_PHASE1={url}\n"

ENV_PATH.write_text(raw, encoding="utf-8")
print("updated .env.local DATABASE_URL_PHASE1 (value not printed)")