#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests
from bs4 import BeautifulSoup

# --- Legacy AI detection config (mirrors your Mechanic logic) ---
AI_PHRASES = [
    "timeless",
    "must-have",
    "embodies",
    "symphony"
    "indulge",
    "essence",
    "allure",
    "prestige",
    "epitomizes",
    "ellegance"
    "unparalleled",
    "exquisite",
    "craftsmanship"
    "sophisticated",
    "elevate your style",
    "ultimate",
    "expression",
    "embody",
    "aesthetic",
    "refined taste",
    "experience",
    "luxurious",
    "prestigious",
    "status",
]

EDITORS_NOTE_MAX_WORDS = 50
MAX_CHAR_COUNT = 1200
MAX_WORD_COUNT = 180
MIN_AI_PHRASES = 1

DEFAULT_TIMEOUT = 120


@dataclass
class Config:
    shop_domain: str
    admin_token: str
    webhook_url: str
    webhook_bearer: str
    sleep_seconds: float = 0.0


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def strip_html_to_text(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def word_count(text: str) -> int:
    if not text:
        return 0
    return len([w for w in re.split(r"\s+", text.strip()) if w])


def count_ai_phrases(html: str) -> int:
    s = (html or "").lower()
    return sum(1 for p in AI_PHRASES if p in s)


def parse_listish_string(value: Optional[str]) -> Optional[str]:
    """
    Handles list-looking strings like:
      ["Birkin"]
      ["Brand New","..."]
    Returns first item, mirroring your Liquid logic.
    """
    if value is None:
        return None
    v = str(value).strip()
    if v == "" or v.lower() == "nan":
        return None

    if v.startswith("[") and v.endswith("]"):
        # Try JSON parse first
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list) and parsed:
                first = parsed[0]
                return str(first).strip() if first is not None else None
        except Exception:
            # Fallback: mimic Liquid remove/split
            v2 = v.replace("[", "").replace("]", "").replace('"', "").replace("\\", "").strip()
            parts = [p.strip() for p in v2.split(",") if p.strip()]
            return parts[0] if parts else None

    return v


def parse_dimensions_list_dimension(dimensions_raw: Optional[str]) -> Any:
    """
    p.dimensions.value is usually JSON for list.dimension.
    Convert to [{value:<num>, unit:<cm>}...] like your Liquid.
    """
    if not dimensions_raw:
        return None
    s = str(dimensions_raw).strip()
    if s == "" or s.lower() == "nan":
        return None
    try:
        parsed = json.loads(s)
        if isinstance(parsed, list):
            out = []
            for d in parsed:
                if not isinstance(d, dict):
                    continue
                val = d.get("value")
                unit = (d.get("unit") or "").lower()
                unit = unit.replace("centimeters", "cm").replace("centimetres", "cm")
                try:
                    val_num = int(float(val))
                except Exception:
                    try:
                        val_num = float(val)
                    except Exception:
                        val_num = val
                out.append({"value": val_num, "unit": unit})
            return out if out else s
        return s
    except Exception:
        return s


def normalize_product_id(raw_id: Any) -> Optional[str]:
    """
    Matrixify ID is often numeric. Convert to gid://shopify/Product/<id>
    """
    if raw_id is None:
        return None
    s = str(raw_id).strip()
    if s == "" or s.lower() == "nan":
        return None
    if s.startswith("gid://"):
        return s
    s2 = re.sub(r"\.0$", "", s)  # Excel float -> int
    if re.fullmatch(r"\d+", s2):
        return f"gid://shopify/Product/{s2}"
    return s


def shopify_graphql(cfg: Config, query: str, variables: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    url = f"https://{cfg.shop_domain}/admin/api/2025-07/graphql.json"
    headers = {
        "X-Shopify-Access-Token": cfg.admin_token,
        "Content-Type": "application/json",
    }
    payload: Dict[str, Any] = {"query": query}
    if variables:
        payload["variables"] = variables

    resp = requests.post(url, headers=headers, json=payload, timeout=DEFAULT_TIMEOUT)
    if resp.status_code != 200:
        raise RuntimeError(f"Shopify GraphQL HTTP {resp.status_code}: {resp.text[:500]}")
    data = resp.json()
    if "errors" in data and data["errors"]:
        raise RuntimeError(f"Shopify GraphQL errors: {data['errors']}")
    return data


PRODUCT_QUERY = """
query ($id: ID!) {
  product(id: $id) {
    id
    title
    vendor
    handle
    descriptionHtml

    bag_style: metafield(namespace:"custom", key:"bag_style") { value }
    bag_size: metafield(namespace:"custom", key:"bag_size") { value }
    condition: metafield(namespace:"custom", key:"condition") { value }
    receipt: metafield(namespace:"custom", key:"receipt") { value }
    accessories: metafield(namespace:"custom", key:"accessories") { value }
    stamp: metafield(namespace:"custom", key:"stamp") { value }
    hardware: metafield(namespace:"custom", key:"hardware") { value }
    dimensions: metafield(namespace:"custom", key:"dimensions") { value }

    hermes_colour: metafield(namespace:"custom", key:"hermes_colour") {
      references(first: 10) {
        nodes { ... on Metaobject { fields { key value } } }
      }
    }

    hermes_material: metafield(namespace:"custom", key:"hermes_material") {
      references(first: 10) {
        nodes { ... on Metaobject { fields { key value } } }
      }
    }

    hermes_hardware: metafield(namespace:"custom", key:"hermes_hardware") {
      reference { ... on Metaobject { fields { key value } } }
    }

    size_style_description: metafield(namespace:"custom", key:"size_style_description") {
      reference {
        ... on Metaobject {
          style_size_descritpion: field(key:"style_size_descritpion") { value }
        }
      }
    }

    hermes_construction: metafield(namespace:"custom", key:"hermes_construction") {
      reference {
        ... on Metaobject {
          construction_description: field(key:"construction_description") { value }
        }
      }
    }
  }
}
"""


def should_process_product(p: Dict[str, Any]) -> Tuple[bool, Optional[str], str]:
    """
    Mirrors your Mechanic skip logic.
    Returns: (should_process, existing_editor_note, reason)
    """
    bag_style_val = (p.get("bag_style") or {}).get("value")
    if not bag_style_val:
        return (False, None, "SKIPPED: Bag Style is empty (non-Hermès handbag / manual description required)")

    desc_html = p.get("descriptionHtml") or ""
    if not desc_html:
        return (True, None, "PROCESS: description empty")

    char_count = len(desc_html)
    text = strip_html_to_text(desc_html)
    wc = word_count(text)

    if 0 < wc <= EDITORS_NOTE_MAX_WORDS:
        return (True, desc_html, f"PROCESS: editor note detected ({wc} words)")

    ai_phrase_count = count_ai_phrases(desc_html)
    is_legacy_ai = (char_count > MAX_CHAR_COUNT) and (wc > MAX_WORD_COUNT) and (ai_phrase_count >= MIN_AI_PHRASES)

    if is_legacy_ai:
        return (True, None, f"PROCESS: legacy AI detected (chars={char_count}, words={wc}, phrases={ai_phrase_count})")

    return (False, None, f"SKIPPED: has description (chars={char_count}, words={wc}, phrases={ai_phrase_count})")


def build_payload_from_product(p: Dict[str, Any], existing_editor_note: Optional[str]) -> Dict[str, Any]:
    """
    Mirrors the payload your Mechanic script sends to the webhook.
    """
    product_hash = {
        "id": p.get("id"),
        "title": p.get("title"),
        "vendor": p.get("vendor"),
        "handle": p.get("handle"),
    }

    specs: Dict[str, Any] = {}

    bag_style_val = parse_listish_string((p.get("bag_style") or {}).get("value"))
    if bag_style_val:
        specs["bag_style"] = bag_style_val

    bag_size_val = (p.get("bag_size") or {}).get("value")
    if bag_size_val not in (None, "", "nan", "NaN"):
        try:
            specs["bag_size_cm"] = int(float(bag_size_val))
        except Exception:
            pass

    condition_val = parse_listish_string((p.get("condition") or {}).get("value"))
    if condition_val:
        specs["condition"] = condition_val

    specs["stamp"] = (p.get("stamp") or {}).get("value")
    specs["receipt"] = (p.get("receipt") or {}).get("value")
    specs["accessories"] = (p.get("accessories") or {}).get("value")
    specs["hardware"] = (p.get("hardware") or {}).get("value")

    dims = parse_dimensions_list_dimension((p.get("dimensions") or {}).get("value"))
    if dims is not None:
        specs["dimensions"] = dims

    colour_descriptions_array: List[str] = []
    material_descriptions_array: List[str] = []
    hardware_description_value = ""

    # hermes_colour refs
    colour_refs = ((p.get("hermes_colour") or {}).get("references") or {}).get("nodes") or []
    if colour_refs:
        colour_categories: List[str] = []
        colour_codes: List[str] = []
        for node in colour_refs:
            for field in node.get("fields") or []:
                k = field.get("key")
                v = field.get("value")
                if not v:
                    continue
                if k in ("blue", "pink_purple", "red", "orange_yellow", "green", "black_grey", "brown", "natural_white"):
                    colour_categories.append(v)
                elif k == "colour_code":
                    colour_codes.append(v)
                elif k == "colour_description":
                    colour_descriptions_array.append(v)

        if colour_categories:
            specs["hermes_colour"] = " | ".join(dict.fromkeys(colour_categories))
        if colour_codes:
            specs["hermes_colour_code"] = " | ".join(dict.fromkeys(colour_codes))

    # hermes_material refs
    material_refs = ((p.get("hermes_material") or {}).get("references") or {}).get("nodes") or []
    if material_refs:
        material_categories: List[str] = []
        for node in material_refs:
            for field in node.get("fields") or []:
                k = field.get("key")
                v = field.get("value")
                if not v:
                    continue
                if k in ("calfskin", "goatskin", "buffalo", "exotic_skins", "canvas", "other"):
                    material_categories.append(v)
                elif k == "material_description":
                    material_descriptions_array.append(v)

        if material_categories:
            specs["hermes_material"] = " | ".join(dict.fromkeys(material_categories))

    # hermes_hardware ref
    hh_ref = ((p.get("hermes_hardware") or {}).get("reference") or {})
    if hh_ref:
        for field in hh_ref.get("fields") or []:
            if field.get("key") == "hardware_description" and field.get("value"):
                hardware_description_value = field["value"]

    puzzle: Dict[str, Any] = {}

    # size_style_description
    ssd_ref = ((p.get("size_style_description") or {}).get("reference") or {})
    if ssd_ref:
        ssd_val = ((ssd_ref.get("style_size_descritpion") or {}) or {}).get("value")
        if ssd_val:
            puzzle["style_size_description"] = ssd_val

    # hermes_construction
    hc_ref = ((p.get("hermes_construction") or {}).get("reference") or {})
    if hc_ref:
        hc_val = ((hc_ref.get("construction_description") or {}) or {}).get("value")
        if hc_val:
            puzzle["construction_description"] = hc_val

    if material_descriptions_array:
        puzzle["material_descriptions"] = material_descriptions_array
    if colour_descriptions_array:
        puzzle["colour_descriptions"] = colour_descriptions_array
    if hardware_description_value:
        puzzle["hardware_description"] = hardware_description_value

    structured: Dict[str, Any] = {
        "specifications": specs,
        "puzzle_description": puzzle,
    }
    if existing_editor_note:
        structured["editor_note"] = existing_editor_note

    return {"product": product_hash, "structured": structured}


def call_webhook(cfg: Config, payload: Dict[str, Any]) -> Dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {cfg.webhook_bearer}",
    }
    resp = requests.post(cfg.webhook_url, headers=headers, json=payload, timeout=DEFAULT_TIMEOUT)
    if resp.status_code != 200:
        raise RuntimeError(f"Webhook HTTP {resp.status_code}: {resp.text[:500]}")
    data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError("Webhook returned non-object JSON.")
    return data


def read_export(path: str) -> pd.DataFrame:
    if path.lower().endswith(".csv"):
        return pd.read_csv(path)
    if path.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(path)
    raise ValueError("Unsupported file type. Use .csv or .xlsx")


def write_export(df: pd.DataFrame, out_path: str) -> None:
    if out_path.lower().endswith(".csv"):
        df.to_csv(out_path, index=False)
    elif out_path.lower().endswith((".xlsx", ".xls")):
        df.to_excel(out_path, index=False)
    else:
        raise ValueError("Unsupported output type. Use .csv or .xlsx")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export_path", help="Matrixify export (.xlsx or .csv)")
    ap.add_argument("--out", default=None, help="Output file path (default adds _updated before extension)")
    ap.add_argument("--sleep", type=float, default=0.0, help="Seconds to sleep between products")
    ap.add_argument("--limit", type=int, default=None, help="Max rows to process (for testing)")
    ap.add_argument("--start-row", type=int, default=0, help="0-based row index to start at")
    ap.add_argument("--write-column", default="Body HTML", help='Column to overwrite (default "Body HTML")')
    ap.add_argument("--status-column", default="AI Backfill Status", help="Column to write status into")
    ap.add_argument("--save-every", type=int, default=10, help="Save progress every N generated rows")
    args = ap.parse_args()

    shop_domain = os.getenv("SHOPIFY_SHOP_DOMAIN", "").strip()
    admin_token = os.getenv("SHOPIFY_ADMIN_TOKEN", "").strip()
    webhook_url = os.getenv("WEBHOOK_URL", "").strip()
    webhook_bearer = os.getenv("WEBHOOK_BEARER_TOKEN", "").strip()

    if not (shop_domain and admin_token and webhook_url and webhook_bearer):
        eprint("Missing env vars. Set SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN, WEBHOOK_URL, WEBHOOK_BEARER_TOKEN.")
        sys.exit(2)

    cfg = Config(shop_domain, admin_token, webhook_url, webhook_bearer, sleep_seconds=args.sleep)

    df = read_export(args.export_path)

    # Must have ID, and we default to overwriting Body HTML
    if "ID" not in df.columns:
        raise ValueError('Export must include an "ID" column.')
    if args.write_column not in df.columns:
        raise ValueError(f'Export is missing the "{args.write_column}" column.')

    # Prepare output path
    if args.out:
        out_path = args.out
    else:
        base, ext = os.path.splitext(args.export_path)
        out_path = f"{base}_updated{ext}"

    # Ensure status column exists
    if args.status_column not in df.columns:
        df[args.status_column] = ""

    total = len(df)
    generated_count = 0

    for idx in range(args.start_row, total):
        if args.limit is not None and (idx - args.start_row) >= args.limit:
            break

        product_gid = normalize_product_id(df.at[idx, "ID"])
        if not product_gid:
            df.at[idx, args.status_column] = "SKIPPED: invalid ID"
            continue

        try:
            data = shopify_graphql(cfg, PRODUCT_QUERY, variables={"id": product_gid})
            p = (data.get("data") or {}).get("product")
            if not p:
                df.at[idx, args.status_column] = "SKIPPED: product not found"
                continue

            should_process, editor_note, reason = should_process_product(p)
            title = p.get("title") or "(no title)"
            eprint(f"[{idx}] {title} — {reason}")

            if not should_process:
                df.at[idx, args.status_column] = reason
                continue

            payload = build_payload_from_product(p, editor_note)
            resp = call_webhook(cfg, payload)

            generated_html = resp.get("description_html")
            if not generated_html:
                raise RuntimeError(f"Webhook missing description_html (keys={list(resp.keys())})")

            # Overwrite Body HTML (or chosen column)
            df.at[idx, args.write_column] = generated_html
            df.at[idx, args.status_column] = "GENERATED"
            eprint(f"✅ [{idx}] Description written successfully")
            generated_count += 1

            if cfg.sleep_seconds:
                time.sleep(cfg.sleep_seconds)

            if args.save_every > 0 and generated_count % args.save_every == 0:
                write_export(df, out_path)

        except Exception as ex:
            df.at[idx, args.status_column] = f"FAILED: {ex}"
            write_export(df, out_path)
            raise  # stop on failure (safe default)

    write_export(df, out_path)
    eprint(f"Done. Wrote: {out_path}")


if __name__ == "__main__":
    main()