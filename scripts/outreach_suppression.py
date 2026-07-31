"""Shared permanent do-not-contact checks for outreach senders."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPPRESSION_FILE = ROOT / "outreach" / "DO_NOT_CONTACT.json"

def _names() -> set[str]:
    try:
        data = json.loads(SUPPRESSION_FILE.read_text())
        values = []
        for person in data.get("people", []):
            values.append(person.get("name", ""))
            values.extend(person.get("aliases", []))
        return {re.sub(r"[^a-z0-9]+", " ", v.lower()).strip() for v in values if v}
    except Exception:
        return set()

SUPPRESSED_NAMES = _names()

def is_suppressed(*values: str) -> bool:
    combined = re.sub(r"[^a-z0-9]+", " ", " ".join(values).lower()).strip()
    return any(name and name in combined for name in SUPPRESSED_NAMES)
