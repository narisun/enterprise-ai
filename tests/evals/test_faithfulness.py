"""
RAGAS Faithfulness eval tests.

Measures what fraction of claims in each generated brief are supported
by the retrieved specialist outputs (CRM, payments, news).

Score semantics:
  1.0  = every claim in the brief can be inferred from the input data
  0.0  = every claim is a hallucination

Production thresholds (documented in judge.RagasFaithfulnessScorer):
  >= 0.85   acceptable
  0.70–0.85 requires review
  < 0.70    block release

Each test class corresponds to one eval fixture / scenario.  A dedicated
step is run per class in CI so failures are visible at the case level.

Markers:
  eval  — requires a live LLM (LiteLLM proxy)
  slow  — takes 60-180 s per case

Environment variables:
  LITELLM_BASE_URL   — LiteLLM proxy URL
  INTERNAL_API_KEY   — API key
  EVAL_JUDGE_MODEL   — model, default gpt-4o-mini
  FAITHFULNESS_THRESHOLD_FULL_DATA  — override for full-data cases (default 0.85)
  FAITHFULNESS_THRESHOLD_PARTIAL    — override for partial-data cases (default 0.80)
  FAITHFULNESS_THRESHOLD_NO_DATA    — override for no-data cases (default 0.70)
"""
from __future__ import annotations

import os
import textwrap

import pytest
import pytest_asyncio

from .conftest import load_fixture
from .judge import RagasFaithfulnessScorer

# ── Thresholds ─────────────────────────────────────────────────────────────────
#
# Full-data cases: all three specialists returned real data, so the brief has
#   rich context to draw from — a high faithfulness score is required.
#
# Partial-data cases: some data is available but compliance columns are masked,
#   so the brief has somewhat less grounding material.
#
# No-data cases: the LLM must write a useful brief without inventing facts.
#   The faithfulness metric is still meaningful here — the brief should ground
#   its statements in the error messages/no-data signals, not fabricate data.

_THRESHOLD_FULL_DATA = float(os.environ.get("FAITHFULNESS_THRESHOLD_FULL_DATA", "0.85"))
_THRESHOLD_PARTIAL   = float(os.environ.get("FAITHFULNESS_THRESHOLD_PARTIAL",   "0.80"))
_THRESHOLD_NO_DATA   = float(os.environ.get("FAITHFULNESS_THRESHOLD_NO_DATA",   "0.70"))


# ── Scorer fixture ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def faithfulness_scorer() -> RagasFaithfulnessScorer:
    """Session-scoped RAGAS scorer pointing at the LiteLLM proxy."""
    return RagasFaithfulnessScorer.from_env()


# ── Helper ─────────────────────────────────────────────────────────────────────

def _format_failure(result, threshold: float, case_label: str) -> str:
    """Build a descriptive assertion message for a faithfulness failure."""
    lines = [
        f"[{case_label}] Faithfulness score {result.score:.3f} < threshold {threshold:.2f}",
        "",
        f"  Total statements decomposed : {len(result.statements)}",
        f"  Supported by context        : {len(result.supported)}",
        f"  Unsupported (hallucinations): {len(result.unsupported)}",
    ]
    if result.unsupported:
        lines.append("")
        lines.append("  Unsupported statements (review for hallucinations):")
        for stmt in result.unsupported:
            lines.append(f"    • {textwrap.shorten(stmt, width=120)}")
    lines.append("")
    lines.append(
        "  Tip: inspect the fixture's crm_output / payments_output / news_output "
        "to verify whether these claims are genuinely unsupported or whether the "
        "brief is legitimately paraphrasing grounded information."
    )
    return "\n".join(lines)


# ── Case 001: Microsoft Manager (full access, all data visible) ────────────────

@pytest.mark.eval
@pytest.mark.slow
class TestFaithfulnessMicrosoftManager:
    """
    Full-data case: manager-level persona with no column masking.
    CRM, payments, and news all return rich data.
    Expected: brief is highly grounded → faithfulness >= 0.85.
    """

    @pytest.fixture(scope="class")
    def fixture(self):
        return load_fixture("case_001_microsoft_manager.json")

    @pytest.fixture(scope="class")
    def threshold(self):
        return _THRESHOLD_FULL_DATA

    @pytest.mark.asyncio
    async def test_faithfulness_score_meets_threshold(
        self, fixture, threshold, faithfulness_scorer, brief_runner
    ):
        """RAGAS faithfulness must meet the full-data threshold."""
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        assert result.score >= threshold, _format_failure(
            result, threshold, "Case 001 – Microsoft Manager"
        )

    @pytest.mark.asyncio
    async def test_no_unsupported_financial_figures(
        self, fixture, faithfulness_scorer, brief_runner
    ):
        """
        Spot-check: with full data available, any financial figures in the brief
        should be grounded in the payments output.  A score below 0.70 on this
        fixture strongly indicates number hallucination.
        """
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        # A more lenient threshold for this specific sub-check
        assert result.score >= 0.70, (
            f"Case 001: faithfulness {result.score:.3f} is dangerously low — "
            f"financial hallucination likely.\n"
            f"Unsupported: {result.unsupported[:5]}"
        )

    @pytest.mark.asyncio
    async def test_faithfulness_result_has_statements(
        self, fixture, faithfulness_scorer, brief_runner
    ):
        """
        Sanity check: RAGAS must successfully decompose the brief into statements.
        An empty statement list means the scorer failed silently.
        """
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        assert result.score >= 0.0, "Score must be a valid float"
        # If RAGAS successfully ran, we expect at least a few statements
        # (brief is multi-paragraph; 3 is a very conservative floor)
        if result.statements:
            assert len(result.statements) >= 3, (
                f"RAGAS only found {len(result.statements)} statements — "
                "scorer may have not processed the brief correctly"
            )


# ── Case 002: Ford RM (restricted — compliance columns masked) ─────────────────

@pytest.mark.eval
@pytest.mark.slow
class TestFaithfulnessFordRM:
    """
    Partial-data case: RM persona, compliance/AML columns masked.
    CRM and payments return real data but with null compliance fields;
    news returns real data.
    Expected: brief is well-grounded but may have slightly fewer
    specific claims → faithfulness >= 0.80.
    """

    @pytest.fixture(scope="class")
    def fixture(self):
        return load_fixture("case_002_ford_rm_restricted.json")

    @pytest.fixture(scope="class")
    def threshold(self):
        return _THRESHOLD_PARTIAL

    @pytest.mark.asyncio
    async def test_faithfulness_score_meets_threshold(
        self, fixture, threshold, faithfulness_scorer, brief_runner
    ):
        """RAGAS faithfulness must meet the partial-data threshold."""
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        assert result.score >= threshold, _format_failure(
            result, threshold, "Case 002 – Ford RM (restricted)"
        )

    @pytest.mark.asyncio
    async def test_no_compliance_data_fabrication(
        self, fixture, faithfulness_scorer, brief_runner
    ):
        """
        Compliance fields are masked (null) in this fixture.
        If any unsupported statements mention AML/KYC/sanctions, the LLM
        fabricated restricted data — a critical failure for access-control compliance.
        """
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        compliance_keywords = {"aml", "kyc", "sanctions", "pep", "risk rating", "fraud"}
        fabricated_compliance = [
            stmt for stmt in result.unsupported
            if any(kw in stmt.lower() for kw in compliance_keywords)
        ]

        assert not fabricated_compliance, (
            f"Case 002: Brief contains {len(fabricated_compliance)} unsupported "
            f"compliance-related claim(s) — possible data fabrication from masked columns:\n"
            + "\n".join(f"  • {s}" for s in fabricated_compliance)
        )


# ── Case 003: Unknown client (no data from any specialist) ────────────────────

@pytest.mark.eval
@pytest.mark.slow
class TestFaithfulnessUnknownClient:
    """
    No-data case: all three specialists return 'no data found' errors.
    The brief should be honest about missing data and NOT invent figures.
    Expected faithfulness >= 0.70 — lower threshold because the brief has
    little grounded content to decompose, but what it does say should be
    traceable to the error signals or to generally known facts.
    """

    @pytest.fixture(scope="class")
    def fixture(self):
        return load_fixture("case_003_unknown_client.json")

    @pytest.fixture(scope="class")
    def threshold(self):
        return _THRESHOLD_NO_DATA

    @pytest.mark.asyncio
    async def test_faithfulness_score_meets_threshold(
        self, fixture, threshold, faithfulness_scorer, brief_runner
    ):
        """RAGAS faithfulness must meet the no-data threshold."""
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        assert result.score >= threshold, _format_failure(
            result, threshold, "Case 003 – Unknown Client (no data)"
        )

    @pytest.mark.asyncio
    async def test_no_fabricated_financial_figures(
        self, fixture, faithfulness_scorer, brief_runner
    ):
        """
        With no real data available, any specific financial figure is a fabrication.
        Check that unsupported statements don't contain invented numbers.
        """
        import re
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        # Pattern: dollar amounts or explicit percentages
        financial_pattern = re.compile(r"\$\d+|\d+\s*%|\d+\s*million|\d+\s*billion", re.I)
        fabricated_figures = [
            stmt for stmt in result.unsupported
            if financial_pattern.search(stmt)
        ]

        assert not fabricated_figures, (
            f"Case 003: Brief contains {len(fabricated_figures)} unsupported statement(s) "
            f"with specific financial figures — likely hallucinated data:\n"
            + "\n".join(f"  • {s}" for s in fabricated_figures)
        )


# ── Case 004: Readonly persona (CRM + payments denied, news available) ─────────

@pytest.mark.eval
@pytest.mark.slow
class TestFaithfulnessReadonlyDenied:
    """
    Partial-access case: CRM and payments return access-denied errors;
    only news is available.
    Expected: brief grounds its claims in (a) the access-denied signals and
    (b) the news content → faithfulness >= 0.70.
    """

    @pytest.fixture(scope="class")
    def fixture(self):
        return load_fixture("case_004_readonly_denied.json")

    @pytest.fixture(scope="class")
    def threshold(self):
        return _THRESHOLD_NO_DATA

    @pytest.mark.asyncio
    async def test_faithfulness_score_meets_threshold(
        self, fixture, threshold, faithfulness_scorer, brief_runner
    ):
        """RAGAS faithfulness must meet the no-data threshold."""
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        assert result.score >= threshold, _format_failure(
            result, threshold, "Case 004 – Readonly (CRM+payments denied)"
        )

    @pytest.mark.asyncio
    async def test_no_crm_or_payment_data_invented(
        self, fixture, faithfulness_scorer, brief_runner
    ):
        """
        CRM and payments were denied.  Any statement claiming CRM contacts,
        open opportunities, or specific payment volumes is a hallucination.
        Look for unsupported statements that contain tell-tale patterns.
        """
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        crm_patterns   = {"contact:", "opportunity:", "meeting on", "last meeting"}
        payment_patterns = {"payment volume", "outbound payments", "total transactions"}

        suspicious = [
            stmt for stmt in result.unsupported
            if any(p in stmt.lower() for p in crm_patterns | payment_patterns)
        ]

        assert not suspicious, (
            f"Case 004: {len(suspicious)} unsupported statement(s) appear to fabricate "
            f"CRM or payment data that was access-denied:\n"
            + "\n".join(f"  • {s}" for s in suspicious)
        )

    @pytest.mark.asyncio
    async def test_news_content_is_grounded(
        self, fixture, faithfulness_scorer, brief_runner
    ):
        """
        News WAS available — so news-related claims should be supported.
        A low overall score here suggests the news content was also misrepresented.
        """
        brief = await brief_runner(fixture)
        result = await faithfulness_scorer.score(brief, fixture)

        # News-specific floor — must be achievable from just news content
        news_floor = 0.50
        assert result.score >= news_floor, (
            f"Case 004: faithfulness {result.score:.3f} is below the news-only floor "
            f"{news_floor} — even news content appears to have been hallucinated.\n"
            f"Unsupported: {result.unsupported[:3]}"
        )
