"""LLM calls: QA generation, answering from retrieved chunks, and LLM-as-judge.

Two providers, picked on the Settings page (or by environment variables):
  - anthropic: Claude through the Anthropic SDK (optional base_url for a gateway)
  - openai:    any OpenAI-compatible /v1/chat/completions server, such as Ollama,
               LM Studio, vLLM or OpenAI itself
"""
from __future__ import annotations

import json
import os
import re
import time

from . import storage

ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5"
# Claude models that accept the server-side refusal fallback ("default" routing).
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

PRESETS = [
    {"id": "anthropic", "label": "Claude (Anthropic)", "provider": "anthropic", "base_url": "", "model": ANTHROPIC_DEFAULT_MODEL},
    {"id": "ollama", "label": "Ollama", "provider": "openai", "base_url": "http://localhost:11434/v1", "model": "qwen2.5:7b"},
    {"id": "lmstudio", "label": "LM Studio", "provider": "openai", "base_url": "http://localhost:1234/v1", "model": ""},
    {"id": "openai", "label": "OpenAI", "provider": "openai", "base_url": "https://api.openai.com/v1", "model": ""},
    {"id": "custom", "label": "OpenAI-compatible อื่น ๆ", "provider": "openai", "base_url": "", "model": ""},
]


class LLMError(RuntimeError):
    pass


# ---------- settings ----------

def settings() -> dict:
    """Saved settings, falling back to environment variables."""
    s = storage.get_settings()
    provider = s.get("provider") or os.environ.get("RAG_EVAL_PROVIDER", "anthropic")
    if provider == "anthropic":
        key = s.get("api_key") or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN") or ""
        default_model = ANTHROPIC_DEFAULT_MODEL
    else:
        key = s.get("api_key") or os.environ.get("OPENAI_API_KEY") or ""
        default_model = ""
    return {
        "preset": s.get("preset") or ("anthropic" if provider == "anthropic" else "custom"),
        "provider": provider,
        "base_url": s.get("base_url") or os.environ.get("RAG_EVAL_BASE_URL", ""),
        "api_key": key,
        "model": s.get("model") or os.environ.get("RAG_EVAL_MODEL", default_model),
        "effort": s.get("effort") or os.environ.get("RAG_EVAL_EFFORT", "low"),
    }


def public_settings() -> dict:
    s = settings()
    k = s.pop("api_key")
    s["api_key_set"] = bool(k)
    s["api_key_hint"] = f"…{k[-4:]}" if len(k) > 8 else ""
    return s


def available() -> bool:
    s = settings()
    if s["provider"] == "anthropic":
        return bool(s["api_key"]) and bool(s["model"])
    return bool(s["base_url"]) and bool(s["model"])


def default_model() -> str:
    return settings()["model"]


_clients: dict[tuple, object] = {}


def _client(s: dict):
    key = (s["provider"], s["base_url"], s["api_key"])
    if key not in _clients:
        if s["provider"] == "anthropic":
            import anthropic
            _clients[key] = anthropic.Anthropic(api_key=s["api_key"] or None, base_url=s["base_url"] or None, max_retries=4)
        else:
            import openai
            # local servers such as Ollama ignore the key, but the SDK requires one
            _clients[key] = openai.OpenAI(api_key=s["api_key"] or "not-needed", base_url=s["base_url"], max_retries=3, timeout=300)
    return _clients[key]


# ---------- one call ----------

def _call(system: str, user: str, schema: dict | None = None, max_tokens: int = 4096, model: str | None = None) -> str:
    s = settings()
    model = model or s["model"]
    if not model:
        raise LLMError("ยังไม่ได้ตั้งชื่อโมเดลในหน้าตั้งค่า")
    if s["provider"] == "anthropic":
        return _call_anthropic(s, model, system, user, schema, max_tokens)
    return _call_openai(s, model, system, user, schema, max_tokens)


def _call_anthropic(s, model, system, user, schema, max_tokens) -> str:
    import anthropic
    params = dict(model=model, max_tokens=max_tokens, system=system,
                  messages=[{"role": "user", "content": user}], output_config={"effort": s["effort"]})
    if schema:
        params["output_config"]["format"] = {"type": "json_schema", "schema": schema}
    client = _client(s)
    try:
        if model in _FALLBACK_MODELS and not s["base_url"]:
            resp = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
        else:
            resp = client.messages.create(**params)
    except anthropic.AuthenticationError as e:
        raise LLMError("API key ไม่ถูกต้อง (authentication failed)") from e
    except anthropic.NotFoundError as e:
        raise LLMError(f"ไม่พบโมเดล {model}") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"Claude API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise LLMError("เชื่อมต่อ Claude API ไม่ได้") from e
    if resp.stop_reason == "refusal":
        raise LLMError("model declined the request")
    if resp.stop_reason == "max_tokens":
        raise LLMError("response hit max_tokens")
    return "".join(b.text for b in resp.content if b.type == "text")


def _call_openai(s, model, system, user, schema, max_tokens) -> str:
    import openai
    client = _client(s)
    messages = [{"role": "system", "content": system}]
    if schema:
        messages[0]["content"] += ("\n\nRespond with only a JSON object that matches this JSON schema, no other text:\n"
                                   + json.dumps(schema, ensure_ascii=False))
    messages.append({"role": "user", "content": user})
    params = dict(model=model, messages=messages, max_tokens=max_tokens)
    # Strict schema output where the server supports it; plain JSON mode or nothing otherwise.
    formats = ([{"type": "json_schema", "json_schema": {"name": "output", "schema": schema}}, {"type": "json_object"}, None]
               if schema else [None])
    last = None
    for fmt in formats:
        try:
            resp = client.chat.completions.create(**params, **({"response_format": fmt} if fmt else {}))
            break
        except openai.BadRequestError as e:  # this server does not accept that response_format
            last = e
            continue
        except openai.AuthenticationError as e:
            raise LLMError("API key ไม่ถูกต้อง (authentication failed)") from e
        except openai.NotFoundError as e:
            raise LLMError(f"ไม่พบโมเดล {model} หรือ base URL ผิด") from e
        except openai.APIStatusError as e:
            raise LLMError(f"API error {e.status_code}: {e.message}") from e
        except openai.APIConnectionError as e:
            raise LLMError(f"เชื่อมต่อ {s['base_url']} ไม่ได้") from e
    else:
        raise LLMError(f"API error: {last}")
    choice = resp.choices[0]
    if choice.finish_reason == "length":
        raise LLMError("response hit max_tokens")
    return choice.message.content or ""


def _json(text: str) -> dict:
    """Parse a JSON object, tolerating code fences or text around it (local models)."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    raise LLMError("โมเดลไม่ได้ตอบเป็น JSON ที่อ่านได้")


def test_connection() -> dict:
    t0 = time.perf_counter()
    text = _call("Reply with exactly: OK", "ping", max_tokens=1024)
    return {"ok": True, "reply": text.strip()[:200], "ms": (time.perf_counter() - t0) * 1000.0,
            "model": default_model()}


# ---------- QA generation ----------

_QA_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "answer": {"type": "string"},
                    "evidence": {"type": "string"},
                },
                "required": ["question", "answer", "evidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

_QA_SYSTEM = """You write test questions for evaluating a retrieval-augmented QA system.
Each question must be answerable from the passage alone, and should be a question a real
user of this document would plausibly ask. Write in the same language as the passage
(usually Thai). Vary the phrasing: do not just copy the passage's wording into the
question, because the test should check retrieval by meaning, not only keyword overlap.
Avoid questions whose answer depends on another part of the document you cannot see.

For each item give:
- question
- answer: short and complete
- evidence: the smallest passage substring that supports the answer, copied EXACTLY
  character for character (same spacing and punctuation), usually one or two sentences."""


def generate_qa(passage: str, n: int, model: str | None = None) -> list[dict]:
    user = f"<passage>\n{passage}\n</passage>\n\nWrite {n} question(s)."
    data = _json(_call(_QA_SYSTEM, user, _QA_SCHEMA, model=model))
    items = [i for i in data.get("items", []) if isinstance(i, dict) and all(isinstance(i.get(k), str) for k in ("question", "answer", "evidence"))]
    return items[:n]


# ---------- answering ----------

_ANSWER_SYSTEM = """Answer the user's question using only the numbered context passages.
If the passages do not contain the answer, say that the information is not in the
documents. Answer in the language of the question, briefly."""


def answer(question: str, contexts: list[str], model: str | None = None) -> tuple[str, float]:
    ctx = "\n\n".join(f"[{i + 1}] {c}" for i, c in enumerate(contexts))
    t0 = time.perf_counter()
    text = _call(_ANSWER_SYSTEM, f"<context>\n{ctx}\n</context>\n\nQuestion: {question}", max_tokens=2048, model=model)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    return text.strip(), (time.perf_counter() - t0) * 1000.0


# ---------- judging ----------

_JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["correct", "partial", "incorrect"]},
        "grounded": {"type": "boolean"},
        "reason": {"type": "string"},
    },
    "required": ["verdict", "grounded", "reason"],
    "additionalProperties": False,
}

_JUDGE_SYSTEM = """You grade answers from a retrieval-augmented QA system.
verdict: compare the candidate answer with the reference answer.
  correct = same facts (wording may differ), partial = some required facts missing or
  slightly off, incorrect = wrong, missing, or says the information is unavailable.
grounded: true only if every factual claim in the candidate answer is supported by the
  retrieved context (regardless of whether it matches the reference).
reason: one short sentence, in the language of the question."""


def judge(question: str, reference: str, candidate: str, contexts: list[str], model: str | None = None) -> dict:
    ctx = "\n\n".join(f"[{i + 1}] {c}" for i, c in enumerate(contexts))
    user = (f"<question>{question}</question>\n<reference_answer>{reference}</reference_answer>\n"
            f"<candidate_answer>{candidate}</candidate_answer>\n<retrieved_context>\n{ctx}\n</retrieved_context>")
    data = _json(_call(_JUDGE_SYSTEM, user, _JUDGE_SCHEMA, max_tokens=2048, model=model))
    verdict = data.get("verdict") if data.get("verdict") in ("correct", "partial", "incorrect") else "incorrect"
    return {"verdict": verdict, "grounded": bool(data.get("grounded")), "reason": str(data.get("reason", ""))}
