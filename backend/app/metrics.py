"""Span-overlap ground truth and aggregate metrics."""
from __future__ import annotations

import numpy as np

from .chunking import Chunk

K_VALUES = (1, 3, 5, 10)
# A retrieved chunk counts as a hit when it overlaps the evidence by at least this share
# of the smaller of the two spans. Small chunks inside a long evidence span still count,
# and a large chunk that only grazes the evidence does not.
HIT_OVERLAP = 0.5


def _overlap(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


def is_hit(chunk: Chunk, evidence: list[dict]) -> bool:
    for ev in evidence:
        if ev["doc_id"] != chunk.doc_id:
            continue
        ov = _overlap(chunk.start, chunk.end, ev["start"], ev["end"])
        if ov and ov >= HIT_OVERLAP * min(chunk.end - chunk.start, ev["end"] - ev["start"]):
            return True
    return False


def coverage(chunks: list[Chunk], evidence: list[dict]) -> float:
    """Share of evidence characters covered by the union of the given chunks."""
    total = covered = 0
    for ev in evidence:
        length = ev["end"] - ev["start"]
        total += length
        mask = np.zeros(length, dtype=bool)
        for c in chunks:
            if c.doc_id == ev["doc_id"]:
                s, e = max(c.start, ev["start"]), min(c.end, ev["end"])
                if e > s:
                    mask[s - ev["start"]:e - ev["start"]] = True
        covered += int(mask.sum())
    return covered / total if total else 0.0


def score_question(retrieved: list[Chunk], evidence: list[dict], k_max: int) -> dict:
    hit_rank = next((i + 1 for i, c in enumerate(retrieved) if is_hit(c, evidence)), None)
    cov = {k: coverage(retrieved[:k], evidence) for k in K_VALUES if k <= k_max}
    return {"hit_rank": hit_rank, "coverage": cov}


def percentiles(values: list[float]) -> dict:
    if not values:
        return {"p50": None, "p95": None, "p99": None, "mean": None}
    a = np.asarray(values)
    return {"p50": float(np.percentile(a, 50)), "p95": float(np.percentile(a, 95)),
            "p99": float(np.percentile(a, 99)), "mean": float(a.mean())}


def aggregate(per_q: list[dict], k_max: int) -> dict:
    n = len(per_q)
    if n == 0:
        return {}
    ranks = [q["hit_rank"] for q in per_q]
    out = {"n": n}
    for k in range(1, k_max + 1):
        out[f"hit@{k}"] = sum(1 for r in ranks if r and r <= k) / n
    out["mrr"] = sum(1.0 / r for r in ranks if r) / n
    for k in K_VALUES:
        if k <= k_max:
            out[f"coverage@{k}"] = sum(q["coverage"][k] for q in per_q) / n
    lat = percentiles([q["latency_ms"] for q in per_q])
    out.update({f"latency_{k}_ms": v for k, v in lat.items()})

    judged = [q["judge"] for q in per_q if q.get("judge")]
    if judged:
        score = {"correct": 1.0, "partial": 0.5, "incorrect": 0.0}
        out["answer_correctness"] = sum(score.get(j["verdict"], 0) for j in judged) / len(judged)
        out["faithfulness"] = sum(1 for j in judged if j["grounded"]) / len(judged)
        gen = percentiles([q["gen_latency_ms"] for q in per_q if q.get("gen_latency_ms") is not None])
        out.update({f"gen_latency_{k}_ms": v for k, v in gen.items()})
        out["n_judged"] = len(judged)
    return out
