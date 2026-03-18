"""
LLM-as-judge for eval tests.

Uses the OpenAI SDK against LITELLM_BASE_URL (or OPENAI_API_KEY directly)
to evaluate whether a generated brief satisfies a set of rubric criteria.

Each rubric criterion is evaluated independently so the score vector shows
exactly which dimensions regressed — a single composite score hides too much.

Usage:
    judge = LLMJudge.from_env()
    scores = await judge.evaluate(brief_markdown, fixture)
    assert scores["cites_payment_volume"] is True
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

from openai import AsyncOpenAI
from pydantic import BaseModel

# ── Rubric definitions ─────────────────────────────────────────────────────────

_RUBRIC_PROMPTS: dict[str, str] = {
    # Data accuracy
    "cites_payment_volume": (
        "Does the brief mention a specific outbound or total payment volume figure "
        "(e.g. a dollar amount like $45M or $31.5M)? Answer yes or no."
    ),
    "cites_trend_increasing": (
        "Does the brief mention that payment volume is INCREASING, growing, or up "
        "by a positive percentage (e.g. +12%)? Answer yes or no."
    ),
    "cites_trend_stable_or_declining": (
        "Does the brief describe payment volume as STABLE, flat, or declining? Answer yes or no."
    ),
    "mentions_top_counterparty": (
        "Does the brief mention at least one specific counterparty company name from "
        "the payments data (e.g. Alphabet, Amazon, Stellantis)? Answer yes or no."
    ),
    "mentions_crm_contact": (
        "Does the brief name at least one specific person from the CRM contacts "
        "(e.g. Jane Smith, Tom Brown)? Answer yes or no."
    ),
    "mentions_open_opportunity": (
        "Does the brief mention at least one open business opportunity or deal "
        "from the CRM data (e.g. FX Hedging, Trade Finance, Supply Chain Finance)? "
        "Answer yes or no."
    ),
    "mentions_news": (
        "Does the brief reference at least one specific news article, headline, or "
        "news source (e.g. Reuters, Bloomberg, WSJ)? Answer yes or no."
    ),

    # Access control
    "compliance_fields_visible": (
        "Does the brief mention any compliance or risk fields such as AML risk category, "
        "KYC status, sanctions status, PEP flag, or risk rating? Answer yes or no."
    ),
    "compliance_fields_not_mentioned": (
        "Does the brief AVOID mentioning compliance-sensitive fields like AML risk, "
        "KYC status, sanctions screening, PEP flag, or fraud segment? "
        "Answer yes (fields are absent) or no (fields are present)."
    ),
    "no_access_denied_message": (
        "Is the brief FREE of phrases like 'access denied', 'unauthorized', "
        "'no access to', or 'data unavailable'? Answer yes or no."
    ),

    # No-data handling
    "acknowledges_no_crm_data": (
        "Does the brief acknowledge that CRM data was unavailable or not found, "
        "rather than fabricating CRM information? Answer yes or no."
    ),
    "acknowledges_no_payment_data": (
        "Does the brief acknowledge that payment data was unavailable or not found? "
        "Answer yes or no."
    ),
    "acknowledges_no_news": (
        "Does the brief note that no recent news was found for this company? Answer yes or no."
    ),
    "no_fabricated_financial_figures": (
        "Does the brief AVOID presenting specific financial figures (revenue, payment volumes, "
        "percentages) that were NOT provided in the input data? "
        "Answer yes (no fabrication) or no (figures were invented)."
    ),
    "no_fabricated_crm_data": (
        "Does the brief AVOID inventing CRM details (contact names, meeting dates, "
        "opportunity amounts) that were not in the CRM input? "
        "Answer yes (no fabrication) or no (data was invented)."
    ),
    "no_fabricated_payment_figures": (
        "Does the brief AVOID presenting payment volume figures, percentages, or "
        "transaction counts that were not provided in the payments input? "
        "Answer yes (no fabrication) or no (figures were invented)."
    ),
    "suggests_verification_steps": (
        "When data is unavailable, does the brief suggest how the RM could verify "
        "or find the missing information? Answer yes or no."
    ),
    "brief_is_useful_despite_no_data": (
        "Even without CRM or payments data, is the brief still useful — does it "
        "provide guidance, suggest actions, or contextualise what is known? "
        "Answer yes or no."
    ),
    "reports_crm_unavailable": (
        "Does the brief clearly communicate that CRM/relationship data was not "
        "accessible or available? Answer yes or no."
    ),
    "reports_payments_unavailable": (
        "Does the brief clearly communicate that payment data was not accessible? "
        "Answer yes or no."
    ),
    "includes_available_news": (
        "Even when other data is unavailable, does the brief include whatever news "
        "was available (e.g. Reuters article about Azure expansion)? Answer yes or no."
    ),
    "does_not_claim_access_it_does_not_have": (
        "Does the brief AVOID claiming to have seen CRM data or payment data when "
        "those tool calls returned access denied errors? Answer yes or no."
    ),
    "brief_is_honest_about_limitations": (
        "Is the brief transparent about what data was and was not available, "
        "rather than pretending everything is fine? Answer yes or no."
    ),

    # Format
    "all_sections_present": (
        "Does the brief include all of the following sections: Executive Summary, "
        "Recent Relationship Activity, Payment Activity, Latest News, Talking Points, "
        "Suggested Questions, and Watch Items? Answer yes or no."
    ),
    "no_fabricated_figures": (
        "Does the brief AVOID presenting any figures or data points that were NOT "
        "present in the input data (CRM, payments, news)? "
        "Answer yes (no fabrication found) or no (some figures appear fabricated)."
    ),
}


class _JudgeOutput(BaseModel):
    criterion: str
    verdict: bool
    reasoning: str


# ── Judge implementation ───────────────────────────────────────────────────────

@dataclass
class LLMJudge:
    client: AsyncOpenAI
    model: str = "gpt-4o-mini"

    @classmethod
    def from_env(cls) -> "LLMJudge":
        base_url = os.environ.get("LITELLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
        api_key  = os.environ.get("INTERNAL_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
        model    = os.environ.get("EVAL_JUDGE_MODEL", "gpt-4o-mini")

        if base_url:
            client = AsyncOpenAI(base_url=base_url + "/v1" if not base_url.endswith("/v1") else base_url,
                                  api_key=api_key)
        else:
            client = AsyncOpenAI(api_key=api_key)

        return cls(client=client, model=model)

    async def _judge_one(self, criterion: str, prompt: str, brief: str, context_json: str) -> _JudgeOutput:
        """Ask the judge a single yes/no question about the brief."""
        system = (
            "You are an expert evaluator assessing AI-generated RM meeting briefs. "
            "You are given: (1) the input data provided to the AI, and (2) the generated brief. "
            "Answer each evaluation question accurately based only on the provided content. "
            "Be strict: if something is only implied but not stated, answer 'no'."
        )
        user = (
            f"## Input data provided to the AI\n\n```json\n{context_json}\n```\n\n"
            f"## Generated brief\n\n{brief}\n\n"
            f"## Evaluation question\n\n{prompt}\n\n"
            "Answer with exactly one of: 'yes' or 'no', then on a new line explain your reasoning in 1-2 sentences."
        )
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            max_tokens=200,
            temperature=0,
        )
        text = response.choices[0].message.content.strip().lower()
        verdict = text.startswith("yes")
        reasoning = text.split("\n", 1)[1].strip() if "\n" in text else ""
        return _JudgeOutput(criterion=criterion, verdict=verdict, reasoning=reasoning)

    async def evaluate(
        self,
        brief_markdown: str,
        fixture: dict,
        criteria: Optional[list[str]] = None,
    ) -> dict[str, _JudgeOutput]:
        """
        Evaluate a brief against the rubric criteria specified in fixture["expected_rubric"].

        Returns a dict mapping criterion_name → JudgeOutput(verdict, reasoning).
        """
        import asyncio

        rubric = fixture.get("expected_rubric", {})
        active_criteria = criteria or list(rubric.keys())

        # Build context JSON for the judge (all specialist outputs)
        context = {
            "client_name":    fixture.get("client_name"),
            "crm_output":     fixture.get("crm_output"),
            "payments_output": fixture.get("payments_output"),
            "news_output":    fixture.get("news_output"),
        }
        context_json = json.dumps(context, indent=2)

        tasks = []
        for criterion in active_criteria:
            if criterion not in _RUBRIC_PROMPTS:
                continue
            tasks.append(
                self._judge_one(criterion, _RUBRIC_PROMPTS[criterion], brief_markdown, context_json)
            )

        results = await asyncio.gather(*tasks, return_exceptions=True)

        scores: dict[str, _JudgeOutput] = {}
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                crit = active_criteria[i]
                scores[crit] = _JudgeOutput(
                    criterion=crit, verdict=False, reasoning=f"Judge error: {result}"
                )
            else:
                scores[result.criterion] = result  # type: ignore[union-attr]
        return scores


# ─────────────────────────────────────────────────────────────────────────────
# RAGAS Faithfulness scorer
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FaithfulnessResult:
    """
    Returned by RagasFaithfulnessScorer.score().

    score       : float 0.0–1.0  — fraction of claims in the brief that are
                  supported by (inferrable from) the specialist output contexts.
                  1.0 = every claim is grounded; 0.0 = fully hallucinated.
    statements  : list of atomic statements RAGAS decomposed from the brief
    supported   : how many of those statements were supported by context
    unsupported : statements RAGAS judged as NOT supported (the hallucinations)
    """
    score: float
    statements: list[str] = field(default_factory=list)
    supported: list[str] = field(default_factory=list)
    unsupported: list[str] = field(default_factory=list)


@dataclass
class RagasFaithfulnessScorer:
    """
    Wraps the RAGAS 0.2.x ``Faithfulness`` metric and points it at our
    LiteLLM proxy so the same model stack is used for generation and evaluation.

    Faithfulness measures what fraction of the claims in the generated brief
    are supported by (inferrable from) the specialist output contexts — CRM,
    payments, and news combined.  A score close to 1.0 means the brief is
    grounded in retrieved data; a low score means the model is hallucinating.

    Why this matters for enterprise architects:
      - It is an objective, reproducible measure of hallucination risk.
      - It is independent of the rubric judge: two complementary signals.
      - Scores can be tracked over model/prompt changes as a regression baseline.

    Thresholds (suggested, adjust per deployment):
      >= 0.85   production-acceptable
      0.70–0.85 review required — inspect ``unsupported`` list
      < 0.70    block release — significant hallucination detected

    Environment variables (same as LLMJudge):
      LITELLM_BASE_URL   — LiteLLM proxy URL (preferred)
      INTERNAL_API_KEY   — API key for the proxy
      EVAL_JUDGE_MODEL   — model name, default gpt-4o-mini
    """
    llm_model: str = "gpt-4o-mini"
    _llm_base_url: str = ""
    _api_key: str = ""

    @classmethod
    def from_env(cls) -> "RagasFaithfulnessScorer":
        base_url = os.environ.get("LITELLM_BASE_URL", "")
        api_key  = os.environ.get("INTERNAL_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
        model    = os.environ.get("EVAL_JUDGE_MODEL", "gpt-4o-mini")
        return cls(llm_model=model, _llm_base_url=base_url, _api_key=api_key)

    def _build_contexts(self, fixture: dict) -> list[str]:
        """
        Flatten the three specialist outputs into a list of context strings
        for RAGAS.  Each source becomes one context chunk so RAGAS can
        attribute which chunk supports (or doesn't support) each claim.
        """
        contexts: list[str] = []
        labels = {
            "crm_output":      "[CRM Data]",
            "payments_output": "[Payments Data]",
            "news_output":     "[News Data]",
        }
        for key, label in labels.items():
            val = fixture.get(key)
            if val is None:
                continue
            if isinstance(val, (dict, list)):
                contexts.append(f"{label}\n{json.dumps(val, indent=2)}")
            else:
                # Error strings (e.g. "ERROR: Unauthorized") are valid context —
                # the brief should acknowledge them, not invent data around them.
                contexts.append(f"{label}\n{val}")
        return contexts

    def _build_ragas_llm(self):
        """Construct a LangchainLLMWrapper pointing at our LiteLLM proxy."""
        from langchain_openai import ChatOpenAI
        from ragas.llms import LangchainLLMWrapper

        kwargs: dict = {"model": self.llm_model, "temperature": 0}
        if self._llm_base_url:
            # Normalise — LiteLLM serves at /v1, LangChain expects the base URL
            base = self._llm_base_url.rstrip("/")
            if not base.endswith("/v1"):
                base = base + "/v1"
            kwargs["base_url"] = base
            kwargs["api_key"]  = self._api_key or "not-needed"
        elif self._api_key:
            kwargs["api_key"] = self._api_key

        return LangchainLLMWrapper(ChatOpenAI(**kwargs))

    def _build_ragas_embeddings(self):
        """Construct embeddings for RAGAS (used for some metrics, not faithfulness)."""
        from langchain_openai import OpenAIEmbeddings
        from ragas.embeddings import LangchainEmbeddingsWrapper

        kwargs: dict = {"model": "text-embedding-ada-002"}
        if self._llm_base_url:
            base = self._llm_base_url.rstrip("/")
            if not base.endswith("/v1"):
                base = base + "/v1"
            kwargs["base_url"] = base
            kwargs["api_key"]  = self._api_key or "not-needed"
        elif self._api_key:
            kwargs["api_key"] = self._api_key

        return LangchainEmbeddingsWrapper(OpenAIEmbeddings(**kwargs))

    async def score(self, brief_markdown: str, fixture: dict) -> FaithfulnessResult:
        """
        Run RAGAS Faithfulness on one (brief, fixture) pair asynchronously.

        RAGAS decomposes the brief into atomic statements, then classifies each
        as supported or unsupported by the provided contexts.  The score is
        supported / total.

        Returns a FaithfulnessResult with the score and the full statement list
        so CI logs can show exactly which claims were flagged as unsupported.
        """
        import asyncio

        from ragas import evaluate, EvaluationDataset
        from ragas.dataset_schema import SingleTurnSample
        from ragas.metrics import Faithfulness

        contexts = self._build_contexts(fixture)
        sample   = SingleTurnSample(
            user_input         = fixture.get("prompt", ""),
            retrieved_contexts = contexts,
            response           = brief_markdown,
        )
        dataset = EvaluationDataset(samples=[sample])

        ragas_llm = self._build_ragas_llm()
        metric    = Faithfulness(llm=ragas_llm)

        # RAGAS 0.2.x evaluate() is synchronous — run in a thread pool so we
        # don't block the pytest-asyncio event loop.
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: evaluate(
                dataset = dataset,
                metrics = [metric],
                raise_exceptions = False,
            ),
        )

        # Extract score — result is a dict-like object with metric names as keys
        faithfulness_score = float(result["faithfulness"] or 0.0)

        # Pull out per-statement details if available (RAGAS stores them in
        # result.scores[0] for the first sample)
        statements:  list[str] = []
        supported:   list[str] = []
        unsupported: list[str] = []

        try:
            sample_scores = result.scores[0] if hasattr(result, "scores") else {}
            raw = sample_scores.get("faithfulness_statements", {})
            if isinstance(raw, dict):
                for stmt, supported_flag in raw.items():
                    statements.append(stmt)
                    if supported_flag:
                        supported.append(stmt)
                    else:
                        unsupported.append(stmt)
        except Exception:
            pass  # Statement-level detail is best-effort; score is what matters

        return FaithfulnessResult(
            score       = faithfulness_score,
            statements  = statements,
            supported   = supported,
            unsupported = unsupported,
        )


def assert_rubric(scores: dict[str, _JudgeOutput], fixture: dict, *, allow_failures: int = 0) -> None:
    """
    Assert that all rubric items marked `true` in fixture["expected_rubric"] pass.
    `allow_failures` lets callers tolerate a small number of failures for flaky LLM outputs.
    """
    rubric = fixture.get("expected_rubric", {})
    failures = []
    for criterion, expected in rubric.items():
        if criterion not in scores:
            continue
        outcome = scores[criterion]
        if expected is True and not outcome.verdict:
            failures.append(f"  FAIL [{criterion}]: {outcome.reasoning}")
        elif expected is False and outcome.verdict:
            failures.append(f"  FAIL [{criterion}] (expected absent but present): {outcome.reasoning}")

    if len(failures) > allow_failures:
        detail = "\n".join(failures)
        raise AssertionError(f"Brief failed {len(failures)} rubric criteria:\n{detail}")
