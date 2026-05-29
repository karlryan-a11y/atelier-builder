#!/usr/bin/env python3
"""
Historical client-data parser for WSG Atelier.

Reads each client folder under the extract dir, pulls the meaningful free-text
documents (Cheat Sheet / Style Profile / Notes / Closet Inventory) plus invoice
xlsx files, runs a single forced-tool-use Claude extraction per client into a
strict JSON schema, matches the client to an existing gp_clients record by name,
and upserts into the shopping/profile tables (migration 004) via the Supabase
REST API using the service-role key.

PII safety:
  * Reads client documents locally only.
  * Audit JSON + report + checkpoint are written OUTSIDE the git repo
    (default: ~/Desktop/wsg-client-import-out) so nothing client-identifying is
    ever committed.
  * Skips obvious secrets (wifi passwords, payment PDFs are never read).

DDL is NOT run here. Tables from migration 004 must already exist.

Usage:
  python3 import_clients.py --report-only          # discover + match, no LLM, no writes
  python3 import_clients.py --limit 3 --dry-run     # extract 3 clients, write audit JSON, no DB
  python3 import_clients.py --client "Alexandra Valenti"
  python3 import_clients.py                          # full run (resumes via checkpoint)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]          # .../atelier-builder
ENV_PATH = REPO_ROOT / ".env.local"
EXTRACT_DIR = Path(os.path.expanduser("~/Desktop/wsg-client-extract"))
OUT_DIR = Path(os.path.expanduser("~/Desktop/wsg-client-import-out"))
AUDIT_DIR = OUT_DIR / "audit"
CHECKPOINT_PATH = OUT_DIR / "checkpoint.json"
REPORT_PATH = OUT_DIR / "report.json"
UNMATCHED_PATH = OUT_DIR / "unmatched.json"

MODEL = os.environ.get("IMPORT_MODEL", "claude-haiku-4-5-20251001")
MAX_DOC_CHARS = 60_000        # cap combined doc text sent to the model per client
NAME_MATCH_CUTOFF = 0.90      # fuzzy match threshold for client name -> gp_clients

# Map free-text category labels -> client_brand_sizing.category enum
CATEGORY_ENUM = {"top", "bottom", "dress", "outerwear", "shoe", "intimates", "accessory"}
CATEGORY_ALIASES = {
    "tops": "top", "top": "top", "shirt": "top", "blouse": "top", "knit": "top", "sweater": "top",
    "bottoms": "bottom", "bottom": "bottom", "pants": "bottom", "jeans": "bottom",
    "trousers": "bottom", "skirt": "bottom", "skirts": "bottom", "shorts": "bottom",
    "dress": "dress", "dresses": "dress",
    "outerwear": "outerwear", "outwear": "outerwear", "jacket": "outerwear",
    "jackets": "outerwear", "coat": "outerwear", "blazer": "outerwear",
    "shoe": "shoe", "shoes": "shoe", "footwear": "shoe", "boot": "shoe", "boots": "shoe",
    "intimates": "intimates", "intimate": "intimates", "lingerie": "intimates",
    "swim": "intimates", "swimwear": "intimates",
    "accessory": "accessory", "accessories": "accessory", "bag": "accessory",
    "jewelry": "accessory", "belt": "accessory", "scarf": "accessory", "hat": "accessory",
}


def norm_category(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower()
    if key in CATEGORY_ENUM:
        return key
    return CATEGORY_ALIASES.get(key)


# ----------------------------------------------------------------------------
# Env loading (no external deps)
# ----------------------------------------------------------------------------

def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        sys.exit(f"FATAL: env file not found at {path}")
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


# ----------------------------------------------------------------------------
# Supabase REST helpers
# ----------------------------------------------------------------------------

class Supabase:
    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = service_key

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def get_all_clients(self) -> list[dict[str, Any]]:
        """Page through gp_clients pulling id + name + email."""
        out: list[dict[str, Any]] = []
        page = 0
        size = 1000
        while True:
            qs = urllib.parse.urlencode({"select": "id,name,email", "limit": size, "offset": page * size})
            req = urllib.request.Request(f"{self.base}/gp_clients?{qs}", headers=self._headers())
            with urllib.request.urlopen(req, timeout=30) as r:
                batch = json.loads(r.read().decode())
            out.extend(batch)
            if len(batch) < size:
                break
            page += 1
        return out

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str | None = None) -> tuple[bool, str]:
        if not rows:
            return True, "no rows"
        params: dict[str, str] = {}
        if on_conflict:
            params["on_conflict"] = on_conflict
        qs = ("?" + urllib.parse.urlencode(params)) if params else ""
        prefer = "resolution=merge-duplicates,return=minimal" if on_conflict else "return=minimal"
        data = json.dumps(rows).encode()
        req = urllib.request.Request(
            f"{self.base}/{table}{qs}",
            data=data,
            headers=self._headers({"Prefer": prefer}),
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return True, f"{r.status}"
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:500]
            return False, f"HTTP {e.code}: {body}"
        except Exception as e:  # noqa: BLE001
            return False, str(e)


# ----------------------------------------------------------------------------
# Name matching
# ----------------------------------------------------------------------------

def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"\(.*?\)", " ", s)        # drop parentheticals: "anya parkhurst (new)"
    s = re.sub(r"'s\b", "", s)            # "ivy wong's" -> "ivy wong"
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(cc|new|husband)\b", " ", s)   # drop suffix tokens "- CC", "(New)"
    s = re.sub(r"\s+", " ", s).strip()
    return s


class ClientMatcher:
    def __init__(self, clients: list[dict[str, Any]]):
        self.by_norm: dict[str, dict[str, Any]] = {}
        for c in clients:
            if c.get("name"):
                self.by_norm.setdefault(norm_name(c["name"]), c)
        self.norm_keys = list(self.by_norm.keys())

    def match(self, folder_name: str) -> tuple[dict[str, Any] | None, float, str]:
        n = norm_name(folder_name)
        if n in self.by_norm:
            return self.by_norm[n], 1.0, "exact"
        # best fuzzy
        best_key, best_score = None, 0.0
        for k in self.norm_keys:
            score = SequenceMatcher(None, n, k).ratio()
            if score > best_score:
                best_key, best_score = k, score
        if best_key and best_score >= NAME_MATCH_CUTOFF:
            return self.by_norm[best_key], best_score, "fuzzy"
        return None, best_score, "none"


# ----------------------------------------------------------------------------
# File discovery
# ----------------------------------------------------------------------------

STYLIST_DIRS_SKIP = {".DS_Store"}

# filename-role classification (lowercased)
ROLE_PATTERNS = [
    ("style_profile", re.compile(r"style profile")),
    ("cheat_sheet", re.compile(r"cheat sheet")),
    ("intake", re.compile(r"intake")),
    ("closet", re.compile(r"closet")),
    ("notes", re.compile(r"(client notes|seasonal planning|\bnotes\b|snapshot|\bss\d{2}\b|\bfw\d{2}\b|spring|summer|fall|winter)")),
    ("invoice", re.compile(r"(invoice|summary|close out|harvest)")),
]
SKIP_FILE = re.compile(r"(payment|ach|contract|wifi|password)", re.I)
SEASON_RE = re.compile(r"\b(SS|FW|S/S|F/W)\s?\d{2,4}\b|\b(spring|summer|fall|winter)\b", re.I)


@dataclass
class ClientDocs:
    stylist: str
    folder_name: str
    path: Path
    txt_files: dict[str, list[Path]] = field(default_factory=dict)   # role -> [paths]
    xlsx_files: list[Path] = field(default_factory=list)

    def all_text_paths(self) -> list[tuple[str, Path]]:
        order = ["style_profile", "cheat_sheet", "intake", "notes", "closet"]
        out = []
        for role in order:
            for p in self.txt_files.get(role, []):
                out.append((role, p))
        return out


def classify(fname: str) -> str | None:
    low = fname.lower()
    for role, pat in ROLE_PATTERNS:
        if pat.search(low):
            return role
    return None


# Generic grouping folders that hold client subfolders (recurse into these);
# everything else at a stylist level is treated as a client folder.
CONTAINER_RE = re.compile(r"(clients?\s*$|consults|invoices|in[- ]?store|archive)", re.I)


def is_container(name: str) -> bool:
    return bool(CONTAINER_RE.search(name.strip().lower()))


def stylist_from_container(name: str, fallback: str) -> str:
    n = name.strip()
    m = re.match(r"(.+?)'?s?\s+clients\s*$", n, re.I)
    if m:
        return m.group(1).strip()
    return fallback


def discover(extract_dir: Path, max_depth: int = 5) -> list[ClientDocs]:
    clients: list[ClientDocs] = []

    def add_client(d: Path, stylist: str) -> None:
        cd = ClientDocs(stylist=stylist, folder_name=d.name.strip(), path=d)
        for p in d.rglob("*"):
            if not p.is_file() or p.name in STYLIST_DIRS_SKIP or SKIP_FILE.search(p.name):
                continue
            ext = p.suffix.lower()
            if ext == ".txt":
                cd.txt_files.setdefault(classify(p.name) or "notes", []).append(p)
            elif ext == ".xlsx":
                cd.xlsx_files.append(p)
        if cd.txt_files or cd.xlsx_files:
            clients.append(cd)

    def walk(d: Path, stylist: str, depth: int) -> None:
        if depth > max_depth:
            return
        for child in sorted(d.iterdir()):
            if not child.is_dir():
                continue
            if is_container(child.name):
                walk(child, stylist_from_container(child.name, stylist), depth + 1)
            else:
                add_client(child, stylist)

    for stylist_dir in sorted(extract_dir.iterdir()):
        if stylist_dir.is_dir():
            walk(stylist_dir, stylist_dir.name.strip(), depth=1)
    return clients


# ----------------------------------------------------------------------------
# Document text assembly
# ----------------------------------------------------------------------------

def read_txt(p: Path) -> str:
    try:
        return p.read_text(errors="replace")
    except Exception:  # noqa: BLE001
        return ""


def read_xlsx(p: Path) -> str:
    """Render an invoice/summary xlsx to compact text for the LLM."""
    try:
        import openpyxl  # local import; optional
    except ImportError:
        return ""
    try:
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    except Exception:  # noqa: BLE001
        return ""
    lines: list[str] = []
    for ws in wb.worksheets:
        lines.append(f"# SHEET: {ws.title}")
        count = 0
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) for c in row if c is not None and str(c).strip()]
            if cells:
                lines.append(" | ".join(cells))
                count += 1
            if count > 200:
                break
    wb.close()
    return "\n".join(lines)


def infer_season_from_name(fname: str) -> str | None:
    m = SEASON_RE.search(fname)
    if not m:
        return None
    return m.group(0).upper().replace(" ", "").replace("/", "")


def assemble_docs(cd: ClientDocs) -> str:
    parts: list[str] = []
    for role, p in cd.all_text_paths():
        season = infer_season_from_name(p.name)
        hdr = f"\n===== DOCUMENT: {role.upper()} | file: {p.name}"
        if season:
            hdr += f" | season_hint: {season}"
        hdr += " ====="
        parts.append(hdr)
        parts.append(read_txt(p))
    for p in cd.xlsx_files:
        season = infer_season_from_name(p.name)
        hdr = f"\n===== DOCUMENT: INVOICE | file: {p.name}"
        if season:
            hdr += f" | season_hint: {season}"
        hdr += " ====="
        parts.append(hdr)
        parts.append(read_xlsx(p))
    text = "\n".join(parts)
    if len(text) > MAX_DOC_CHARS:
        text = text[:MAX_DOC_CHARS] + "\n...[truncated]"
    return text


# ----------------------------------------------------------------------------
# Claude extraction (forced tool use)
# ----------------------------------------------------------------------------

EXTRACTION_TOOL = {
    "name": "save_client_profile",
    "description": "Save the structured styling profile extracted from a WSG client's documents.",
    "input_schema": {
        "type": "object",
        "properties": {
            "profile": {
                "type": "object",
                "properties": {
                    "body_type": {"type": ["string", "null"], "description": "e.g. pear, apple, hourglass, rectangle, inverted triangle"},
                    "color_season": {"type": ["string", "null"], "description": "color analysis season if stated, else null"},
                    "size_top": {"type": ["string", "null"]},
                    "size_bottom": {"type": ["string", "null"]},
                    "size_dress": {"type": ["string", "null"]},
                    "size_outerwear": {"type": ["string", "null"]},
                    "size_shoe": {"type": ["string", "null"]},
                    "size_intimates": {"type": ["string", "null"]},
                    "size_accessories": {"type": ["string", "null"]},
                    "fit_notes": {"type": "object", "description": "keyed by category (top/bottom/dress/outerwear/shoe/intimates/accessory); each value an object with optional size and fit strings"},
                    "style_story": {"type": ["string", "null"], "description": "the client's style statement / story prose"},
                    "occasions": {"type": "array", "items": {"type": "string"}},
                    "color_palette": {"type": "object", "description": "e.g. {loves:[...], avoids:[...]}"},
                    "fabric_preferences": {"type": "object", "description": "e.g. {loves:[...], avoids:[...]}"},
                    "no_fly_list": {"type": ["string", "null"], "description": "silhouettes, details, colors, prints the client will NOT wear"},
                    "gap_notes": {"type": ["string", "null"], "description": "what the client already owns / wardrobe gaps"},
                },
            },
            "measurements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "measured_on": {"type": ["string", "null"], "description": "ISO date YYYY-MM-DD if the document gives one, else null"},
                        "measurements": {"type": "object", "description": "numeric measurements keyed by name, e.g. full_bust, natural_waist, full_hip, height, shoulder_to_shoulder, neck"},
                    },
                },
            },
            "brand_sizing": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "brand": {"type": "string"},
                        "category": {"type": "string", "description": "one of: top, bottom, dress, outerwear, shoe, intimates, accessory"},
                        "size": {"type": "string"},
                        "fit_note": {"type": ["string", "null"]},
                    },
                    "required": ["brand", "category", "size"],
                },
            },
            "brand_preferences": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "brand": {"type": "string"},
                        "preference": {"type": "string", "description": "one of: preferred, neutral, blocked"},
                        "note": {"type": ["string", "null"]},
                    },
                    "required": ["brand", "preference"],
                },
            },
            "seasons": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string", "description": "e.g. SS26, FW23"},
                        "season_type": {"type": ["string", "null"], "description": "SS, FW, resort, pre_fall, or other"},
                        "year": {"type": ["integer", "null"]},
                        "budget_total": {"type": ["number", "null"]},
                        "otb_carryover": {"type": ["number", "null"]},
                        "notes": {"type": ["string", "null"]},
                    },
                    "required": ["label"],
                },
            },
            "shopping_slots": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "season_label": {"type": ["string", "null"]},
                        "description": {"type": "string"},
                        "category": {"type": ["string", "null"]},
                        "budget_guidance": {"type": ["number", "null"]},
                    },
                    "required": ["description"],
                },
            },
        },
        "required": ["profile", "measurements", "brand_sizing", "brand_preferences", "seasons", "shopping_slots"],
    },
}

SYSTEM_PROMPT = """You extract structured styling intelligence from a personal stylist's client documents.

The documents are free-text Cheat Sheets, Style Profiles, seasonal Notes, Closet Inventories, and invoice spreadsheets. They are inconsistent and often have blank template fields. Extract ONLY information that is actually present; never invent. Use null / empty arrays for anything not stated.

Guidance:
- profile.body_type: the stated body shape (pear, apple, hourglass, rectangle, inverted triangle). null if blank.
- profile sizes: the client's general size per category from the quick "Sizing" block.
- fit_notes: per-category fit nuance from the "Sizing/Fit Strategy" section (e.g. {"top": {"size": "S-M", "fit": "v-neck, nothing too low; loves cotton/linen"}}).
- brand_sizing: every (brand, category, size) the documents associate, e.g. "Pants 8 or 10, Ann Taylor" -> {brand:"Ann Taylor", category:"bottom", size:"8-10", fit_note:"pants"}. category MUST be one of: top, bottom, dress, outerwear, shoe, intimates, accessory.
- brand_preferences: brands the client likes (preferred), is neutral on, or dislikes (blocked), with a short reason in note.
- measurements: from the MEASUREMENTS block; keep numbers; measured_on = a date only if the document states one, else null.
- seasons: any buying season referenced (from filenames like "SS26 Notes" or headings). Pull budget_total / otb_carryover only if an explicit dollar figure is given.
- shopping_slots: individual items from "SHOPPING LIST" sections (BOTTOMS/TOPS/OUTERWEAR/FOOTWEAR/ACCESSORIES). Each becomes one slot with description, normalized category, and the season_label it appeared under.
- no_fly_list: consolidate "NO" / caution items the client won't wear.

Call save_client_profile exactly once with the extracted data."""


def extract_with_claude(anthropic_client, client_name: str, docs_text: str) -> dict[str, Any]:
    msg = anthropic_client.messages.create(
        model=MODEL,
        max_tokens=8000,
        system=SYSTEM_PROMPT,
        tools=[EXTRACTION_TOOL],
        tool_choice={"type": "tool", "name": "save_client_profile"},
        messages=[{
            "role": "user",
            "content": f"Client: {client_name}\n\nDOCUMENTS:\n{docs_text}",
        }],
    )
    for block in msg.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "save_client_profile":
            return block.input
    raise RuntimeError("model did not return tool_use")


# ----------------------------------------------------------------------------
# Mapping extracted JSON -> DB rows
# ----------------------------------------------------------------------------

def safe_str(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return None
    s = str(v).strip()
    return s or None


def as_dict(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def as_list(v: Any) -> list:
    return v if isinstance(v, list) else []


def build_rows(client_id: str, data: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    rows: dict[str, list[dict[str, Any]]] = {
        "client_profiles": [],
        "client_measurements": [],
        "client_brand_sizing": [],
        "client_brand_preferences": [],
        "shopping_seasons": [],
    }

    prof = as_dict(data.get("profile"))
    # latest measurement snapshot for the convenience column
    measurements_list = [m for m in as_list(data.get("measurements")) if isinstance(m, dict)]
    snapshot = as_dict(measurements_list[-1].get("measurements")) if measurements_list else {}
    rows["client_profiles"].append({
        "client_id": client_id,
        "body_type": safe_str(prof.get("body_type")),
        "color_season": safe_str(prof.get("color_season")),
        "size_top": safe_str(prof.get("size_top")),
        "size_bottom": safe_str(prof.get("size_bottom")),
        "size_dress": safe_str(prof.get("size_dress")),
        "size_outerwear": safe_str(prof.get("size_outerwear")),
        "size_shoe": safe_str(prof.get("size_shoe")),
        "size_intimates": safe_str(prof.get("size_intimates")),
        "size_accessories": safe_str(prof.get("size_accessories")),
        "fit_notes": as_dict(prof.get("fit_notes")),
        "measurements": snapshot,
        "style_story": safe_str(prof.get("style_story")),
        "occasions": as_list(prof.get("occasions")),
        "color_palette": as_dict(prof.get("color_palette")),
        "fabric_preferences": as_dict(prof.get("fabric_preferences")),
        "no_fly_list": safe_str(prof.get("no_fly_list")),
        "gap_notes": safe_str(prof.get("gap_notes")),
        "source": "historical_import",
    })

    seen_dates: set[str] = set()
    for i, m in enumerate(measurements_list):
        meas = m.get("measurements") or {}
        if not meas:
            continue
        d = safe_str(m.get("measured_on")) or "2020-01-01"   # undated historical fallback
        # de-dup measured_on within a client (unique constraint)
        while d in seen_dates:
            # nudge the day to keep multiple undated snapshots distinct
            d = bump_date(d)
        seen_dates.add(d)
        rows["client_measurements"].append({
            "client_id": client_id,
            "measured_on": d,
            "measurements": meas,
            "source": "historical_import",
        })

    seen_bs: set[tuple[str, str]] = set()
    for b in as_list(data.get("brand_sizing")):
        if not isinstance(b, dict):
            continue
        brand = safe_str(b.get("brand"))
        cat = norm_category(b.get("category"))
        size = safe_str(b.get("size"))
        if not (brand and cat and size):
            continue
        key = (brand.lower(), cat)
        if key in seen_bs:
            continue
        seen_bs.add(key)
        rows["client_brand_sizing"].append({
            "client_id": client_id,
            "brand": brand,
            "category": cat,
            "size": size,
            "fit_note": safe_str(b.get("fit_note")),
            "confidence": "worn_once",
        })

    seen_bp: set[str] = set()
    for b in as_list(data.get("brand_preferences")):
        if not isinstance(b, dict):
            continue
        brand = safe_str(b.get("brand"))
        pref = safe_str(b.get("preference"))
        if not brand or pref not in {"preferred", "neutral", "blocked"}:
            continue
        if brand.lower() in seen_bp:
            continue
        seen_bp.add(brand.lower())
        rows["client_brand_preferences"].append({
            "client_id": client_id,
            "brand": brand,
            "preference": pref,
            "note": safe_str(b.get("note")),
        })

    seen_seasons: set[str] = set()
    for s in as_list(data.get("seasons")):
        if not isinstance(s, dict):
            continue
        label = safe_str(s.get("label"))
        if not label or label.lower() in seen_seasons:
            continue
        seen_seasons.add(label.lower())
        st = safe_str(s.get("season_type"))
        if st not in {"SS", "FW", "resort", "pre_fall", "other", None}:
            st = "other"
        rows["shopping_seasons"].append({
            "client_id": client_id,
            "label": label,
            "season_type": st,
            "year": s.get("year") if isinstance(s.get("year"), int) else None,
            "budget_total": num(s.get("budget_total")),
            "otb_carryover": num(s.get("otb_carryover")) or 0,
            "notes": safe_str(s.get("notes")),
            "source": "historical_import",
        })

    return rows


def num(v: Any) -> float | None:
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.search(r"-?\d[\d,]*\.?\d*", v.replace("$", ""))
        if m:
            try:
                return float(m.group(0).replace(",", ""))
            except ValueError:
                return None
    return None


def bump_date(d: str) -> str:
    # crude day-increment for de-duping undated snapshots; good enough for fallbacks
    y, m, day = (int(x) for x in d.split("-"))
    day += 1
    if day > 28:
        day = 1
        m += 1
    if m > 12:
        m = 1
        y += 1
    return f"{y:04d}-{m:02d}-{day:02d}"


# ----------------------------------------------------------------------------
# Checkpoint
# ----------------------------------------------------------------------------

def load_checkpoint() -> dict[str, Any]:
    if CHECKPOINT_PATH.exists():
        return json.loads(CHECKPOINT_PATH.read_text())
    return {"done": {}}


def save_checkpoint(cp: dict[str, Any]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_PATH.write_text(json.dumps(cp, indent=2))


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="process at most N clients")
    ap.add_argument("--client", type=str, default=None, help="only this client folder name")
    ap.add_argument("--dry-run", action="store_true", help="extract + write audit, no DB writes")
    ap.add_argument("--report-only", action="store_true", help="discovery + matching only, no LLM, no writes")
    ap.add_argument("--no-resume", action="store_true", help="ignore checkpoint")
    ap.add_argument("--stylist", type=str, default=None, help="only clients under this stylist folder")
    args = ap.parse_args()

    if not EXTRACT_DIR.exists():
        sys.exit(f"FATAL: extract dir not found at {EXTRACT_DIR}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)

    env = load_env(ENV_PATH)
    url = env.get("VITE_SUPABASE_URL")
    srk = env.get("SUPABASE_SERVICE_ROLE_KEY")
    akey = env.get("VITE_ANTHROPIC_API_KEY")
    if not url or not srk:
        sys.exit("FATAL: missing Supabase URL or service role key in .env.local")

    sb = Supabase(url, srk)
    print(f"Fetching existing clients from gp_clients ...")
    all_clients = sb.get_all_clients()
    print(f"  {len(all_clients)} clients loaded")
    matcher = ClientMatcher(all_clients)

    print(f"Discovering client folders under {EXTRACT_DIR} ...")
    discovered = discover(EXTRACT_DIR)
    if args.stylist:
        discovered = [c for c in discovered if args.stylist.lower() in c.stylist.lower()]
    if args.client:
        discovered = [c for c in discovered if norm_name(args.client) == norm_name(c.folder_name)]
    print(f"  {len(discovered)} client folders discovered")

    # Match report
    report: dict[str, Any] = {"matched": [], "fuzzy": [], "unmatched": [], "stats": {}}
    for cd in discovered:
        m, score, kind = matcher.match(cd.folder_name)
        entry = {
            "stylist": cd.stylist,
            "folder": cd.folder_name,
            "match_name": m["name"] if m else None,
            "client_id": m["id"] if m else None,
            "score": round(score, 3),
            "kind": kind,
            "docs": {role: [p.name for p in ps] for role, ps in cd.txt_files.items()},
            "xlsx": [p.name for p in cd.xlsx_files],
        }
        cd._match = m  # type: ignore[attr-defined]
        cd._match_kind = kind  # type: ignore[attr-defined]
        if kind == "exact":
            report["matched"].append(entry)
        elif kind == "fuzzy":
            report["fuzzy"].append(entry)
        else:
            report["unmatched"].append(entry)

    report["stats"] = {
        "discovered": len(discovered),
        "exact": len(report["matched"]),
        "fuzzy": len(report["fuzzy"]),
        "unmatched": len(report["unmatched"]),
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2))
    UNMATCHED_PATH.write_text(json.dumps(report["unmatched"], indent=2))
    print(f"  matched(exact)={report['stats']['exact']} fuzzy={report['stats']['fuzzy']} unmatched={report['stats']['unmatched']}")
    print(f"  report -> {REPORT_PATH}")

    if args.report_only:
        return

    # need anthropic for extraction
    try:
        import anthropic
    except ImportError:
        sys.exit("FATAL: `anthropic` not installed (pip install anthropic)")
    if not akey:
        sys.exit("FATAL: missing VITE_ANTHROPIC_API_KEY in .env.local")
    ac = anthropic.Anthropic(api_key=akey)

    cp = {"done": {}} if args.no_resume else load_checkpoint()

    # Only process matched (exact + fuzzy) clients — they have a valid FK target
    targets = [cd for cd in discovered if getattr(cd, "_match", None)]
    if args.limit:
        targets = targets[: args.limit]
    print(f"\nProcessing {len(targets)} matched clients (model={MODEL}, dry_run={args.dry_run})\n")

    totals = {"clients": 0, "client_profiles": 0, "client_measurements": 0,
              "client_brand_sizing": 0, "client_brand_preferences": 0, "shopping_seasons": 0,
              "errors": 0, "skipped": 0}

    for i, cd in enumerate(targets, 1):
        m = cd._match  # type: ignore[attr-defined]
        cid = m["id"]
        tag = f"[{i}/{len(targets)}] {cd.folder_name} -> {m['name']} ({cid})"
        if cid in cp["done"] and not args.dry_run:
            print(f"{tag}  SKIP (checkpoint)")
            totals["skipped"] += 1
            continue
        docs_text = assemble_docs(cd)
        if not docs_text.strip():
            print(f"{tag}  SKIP (no text)")
            totals["skipped"] += 1
            continue
        try:
            data = extract_with_claude(ac, m["name"], docs_text)
        except Exception as e:  # noqa: BLE001
            print(f"{tag}  ERROR extract: {e}")
            totals["errors"] += 1
            continue

        # audit dump (PII-safe location, outside repo)
        (AUDIT_DIR / f"{cid}.json").write_text(json.dumps(
            {"folder": cd.folder_name, "stylist": cd.stylist, "match": m, "extracted": data},
            indent=2, ensure_ascii=False))

        rows = build_rows(cid, data)
        counts = {k: len(v) for k, v in rows.items()}

        if args.dry_run:
            print(f"{tag}  DRY {counts}")
        else:
            ok_all = True
            for table, on_conflict in [
                ("client_profiles", "client_id"),
                ("client_measurements", "client_id,measured_on"),
                ("client_brand_sizing", "client_id,brand,category"),
                ("client_brand_preferences", "client_id,brand"),
                ("shopping_seasons", "client_id,label"),
            ]:
                ok, info = sb.upsert(table, rows[table], on_conflict=on_conflict)
                if not ok:
                    ok_all = False
                    print(f"{tag}  WRITE FAIL {table}: {info}")
            if ok_all:
                cp["done"][cid] = {"folder": cd.folder_name, "counts": counts, "ts": time.time()}
                save_checkpoint(cp)
                print(f"{tag}  OK {counts}")
            else:
                totals["errors"] += 1
                continue

        for k in counts:
            totals[k] += counts[k]
        totals["clients"] += 1

    print(f"\n==== DONE ====")
    print(json.dumps(totals, indent=2))
    print(f"audit dumps -> {AUDIT_DIR}")


if __name__ == "__main__":
    main()
