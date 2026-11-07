"""Persistence: Vultr Managed PostgreSQL for records, cases and events; Vultr Object Storage for documents.

Each case sees the shared base ERP plus its own changes (erp_overrides) and its own added documents
(documents.scope = case id), so any incident can be rerun from the start as a fresh copy.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
import threading

import boto3
from botocore.config import Config
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pypdf import PdfReader

from app.rules import World

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS erp_records (id text PRIMARY KEY, kind text NOT NULL, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS erp_overrides (case_id text NOT NULL, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (case_id, id));
CREATE TABLE IF NOT EXISTS documents (
  scope text NOT NULL DEFAULT '', id text NOT NULL, kind text NOT NULL, title text NOT NULL, trust text NOT NULL, format text NOT NULL,
  related jsonb NOT NULL, s3_key text NOT NULL, sha256 text NOT NULL, size_bytes int NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (scope, id));
CREATE TABLE IF NOT EXISTS cases (
  id text PRIMARY KEY, title text NOT NULL, status text NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), invoice_ids jsonb NOT NULL, supplier_ids jsonb NOT NULL,
  trigger text NOT NULL, potential_exposure numeric NOT NULL, template text, state jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS events (
  seq bigserial PRIMARY KEY, case_id text NOT NULL, at timestamptz NOT NULL DEFAULT now(), agent text NOT NULL,
  type text NOT NULL, text text NOT NULL, data jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX IF NOT EXISTS events_case ON events(case_id, seq);
"""


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


class Store:
    def __init__(self, database_url: str, s3: dict):
        self.pool = ConnectionPool(database_url, min_size=1, max_size=10,
                                   kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None}, open=True)
        self.bucket = s3["bucket"]
        self.s3 = boto3.client("s3", endpoint_url=s3["endpoint"], aws_access_key_id=s3["access_key"],
                               aws_secret_access_key=s3["secret_key"], region_name="us-east-1",
                               config=Config(signature_version="s3v4", retries={"max_attempts": 3}))
        self.s3_endpoint = s3["endpoint"]
        self._text_cache: dict[str, str] = {}
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "Store":
        return cls(os.environ["DATABASE_URL"], {
            "endpoint": os.environ["S3_ENDPOINT"], "access_key": os.environ["S3_ACCESS_KEY"],
            "secret_key": os.environ["S3_SECRET_KEY"], "bucket": os.environ.get("S3_BUCKET", "controlroom-northstar")})

    def q(self, sql: str, params=None) -> list[dict]:
        with self.pool.connection() as c:
            cur = c.execute(sql, params)
            return cur.fetchall() if cur.description else []

    def init(self):
        with self.pool.connection() as c:
            c.execute(SCHEMA)

    # ---------------- world
    def world(self, case_id: str = "", docs: bool = True) -> World:
        over = {r["id"]: r["data"] for r in self.q("SELECT id, data FROM erp_overrides WHERE case_id = %s", (case_id,))}
        records: dict[str, list[dict]] = {}
        for r in self.q("SELECT kind, id, data FROM erp_records ORDER BY id"):
            records.setdefault(r["kind"], []).append({**r["data"], **over.get(r["id"], {})})
        meta = {r["key"]: r["value"] for r in self.q("SELECT key, value FROM meta")}
        meta["documents"] = self.documents_with_text(case_id) if docs else []
        return World(records, meta)

    def update_record(self, case_id: str, record_id: str, changes: dict):
        self.q("""INSERT INTO erp_overrides (case_id, id, data) VALUES (%s,%s,%s)
                  ON CONFLICT (case_id, id) DO UPDATE SET data = erp_overrides.data || excluded.data""",
               (case_id, record_id, Jsonb(changes)))

    # ---------------- documents
    def put_document(self, d: dict, body: bytes, content_type: str, scope: str = ""):
        key = f"northstar/{scope + '/' if scope else ''}{d['kind']}/{d['id']}.{d['format']}"
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType=content_type)
        self.q("""INSERT INTO documents (scope, id, kind, title, trust, format, related, s3_key, sha256, size_bytes)
                  VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                  ON CONFLICT (scope, id) DO UPDATE SET title=excluded.title, trust=excluded.trust, related=excluded.related,
                  s3_key=excluded.s3_key, sha256=excluded.sha256, size_bytes=excluded.size_bytes""",
               (scope, d["id"], d["kind"], d["title"], d["trust"], d["format"], Jsonb(d["related"]), key,
                hashlib.sha256(body).hexdigest(), len(body)))
        with self._lock:
            self._text_cache.pop(key, None)

    def document(self, doc_id: str, case_id: str = "") -> dict | None:
        rows = self.q("SELECT * FROM documents WHERE id = %s AND scope IN ('', %s) ORDER BY scope DESC", (doc_id, case_id))
        return rows[0] if rows else None

    def list_documents(self, case_id: str = "") -> list[dict]:
        return self.q("SELECT scope, id, kind, title, trust, format, related, s3_key, sha256, size_bytes, added_at FROM documents "
                      "WHERE scope IN ('', %s) ORDER BY id", (case_id,))

    def document_bytes(self, doc_id: str, case_id: str = "") -> tuple[bytes, dict]:
        d = self.document(doc_id, case_id)
        if not d:
            raise KeyError(doc_id)
        body = self.s3.get_object(Bucket=self.bucket, Key=d["s3_key"])["Body"].read()
        return body, d

    def document_text(self, doc_id: str, case_id: str = "") -> str:
        """Reads the original file from Object Storage and extracts its text."""
        d = self.document(doc_id, case_id)
        if not d:
            raise KeyError(doc_id)
        with self._lock:
            if d["s3_key"] in self._text_cache:
                return self._text_cache[d["s3_key"]]
        body = self.s3.get_object(Bucket=self.bucket, Key=d["s3_key"])["Body"].read()
        if d["format"] == "pdf":
            text = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(body)).pages)
        else:
            text = body.decode("utf-8", errors="replace")
        with self._lock:
            self._text_cache[d["s3_key"]] = text
        return text

    def documents_with_text(self, case_id: str = "") -> list[dict]:
        out = []
        for d in self.list_documents(case_id):
            try:
                out.append({**d, "text": self.document_text(d["id"], case_id)})
            except Exception:
                out.append({**d, "text": ""})
        return out

    def put_report(self, case_id: str, body: bytes) -> str:
        key = f"reports/{case_id}.json"
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType="application/json")
        return key

    def get_report(self, case_id: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=f"reports/{case_id}.json")["Body"].read()

    # ---------------- cases and events
    def case(self, case_id: str) -> dict | None:
        rows = self.q("SELECT * FROM cases WHERE id = %s", (case_id,))
        return rows[0] if rows else None

    def cases(self) -> list[dict]:
        return self.q("SELECT id, title, status, opened_at, updated_at, invoice_ids, supplier_ids, trigger, potential_exposure, template, "
                      "state->'summary' AS summary FROM cases ORDER BY opened_at DESC, id")

    def merge_state(self, case_id: str, patch: dict, status: str | None = None):
        patch = json.loads(json.dumps(patch, default=str))
        if status:
            self.q("UPDATE cases SET state = state || %s, status = %s, updated_at = now() WHERE id = %s", (Jsonb(patch), status, case_id))
        else:
            self.q("UPDATE cases SET state = state || %s, updated_at = now() WHERE id = %s", (Jsonb(patch), case_id))

    def set_status(self, case_id: str, status: str):
        self.q("UPDATE cases SET status = %s, updated_at = now() WHERE id = %s", (status, case_id))

    def event(self, case_id: str, agent: str, type_: str, text: str, data: dict | None = None) -> int:
        rows = self.q("INSERT INTO events (case_id, agent, type, text, data) VALUES (%s,%s,%s,%s,%s) RETURNING seq",
                      (case_id, agent, type_, text, Jsonb(json.loads(json.dumps(data or {}, default=str)))))
        return rows[0]["seq"]

    def events(self, case_id: str, after: int = 0) -> list[dict]:
        return self.q("SELECT seq, at, agent, type, text, data FROM events WHERE case_id = %s AND seq > %s ORDER BY seq",
                      (case_id, after))

    def cost(self, case_id: str) -> dict:
        r = self.q("""SELECT count(*) AS calls, coalesce(sum((data->>'prompt_tokens')::int + (data->>'completion_tokens')::int), 0) AS tokens,
                      sum((data->>'cost_usd')::float) AS cost_usd, count(*) FILTER (WHERE data->>'cost_usd' IS NULL) AS unpriced
                      FROM events WHERE case_id = %s AND type = 'llm_call'""", (case_id,))[0]
        return {"calls": r["calls"], "tokens": int(r["tokens"]), "cost_usd": r["cost_usd"], "unpriced_calls": r["unpriced"]}
