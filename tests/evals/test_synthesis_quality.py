"""
Eval tests — synthesis quality via LLM-as-judge.

For each eval fixture, runs the full rm-prep pipeline via /brief/persona,
then evaluates the output against a rubric using the LLM judge.

Each rubric dimension is an independent test so CI shows exactly which
dimension regressed — not just "eval failed".

Requires (all services running):
  - rm-prep-agent, payments-mcp, salesforce-mcp, news-search-mcp, litellm
  - LITELLM_BASE_URL or OPENAI_API_KEY (for the judge)
  - INTERNAL_API_KEY, JWT_SECRET
"""
import pytest

from .judge import LLMJudge, assert_rubric

pytestmark = [pytest.mark.eval, pytest.mark.asyncio, pytest.mark.slow]


# ─────────────────────────────────────────────────────────────────────────────
# Helper: run brief once per fixture, cache in session
# ─────────────────────────────────────────────────────────────────────────────

_brief_cache: dict[str, str] = {}


async def _get_brief(brief_runner, fixture: dict) -> str:
    key = fixture.get("client_name", "") + fixture.get("persona", "")
    if key not in _brief_cache:
        _brief_cache[key] = await brief_runner(fixture)
    return _brief_cache[key]


# ─────────────────────────────────────────────────────────────────────────────
# CASE 001: Microsoft Corp. — manager role (full access)
# ─────────────────────────────────────────────────────────────────────────────

class TestMicrosoftManagerBrief:
    """
    Manager has full clearance — brief should include all data including
    compliance fields, and accurately cite the 12.3% volume increase.
    """

    @pytest.fixture(autouse=True, scope="class")
    async def _brief(self, request, brief_runner, fixture_microsoft_manager):
        request.cls._brief_md = await _get_brief(brief_runner, fixture_microsoft_manager)
        request.cls._fixture = fixture_microsoft_manager

    async def test_cites_payment_volume(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["cites_payment_volume"])
        assert scores["cites_payment_volume"].verdict, scores["cites_payment_volume"].reasoning

    async def test_cites_trend_increasing(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["cites_trend_increasing"])
        assert scores["cites_trend_increasing"].verdict, scores["cites_trend_increasing"].reasoning

    async def test_mentions_top_counterparty(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["mentions_top_counterparty"])
        assert scores["mentions_top_counterparty"].verdict, scores["mentions_top_counterparty"].reasoning

    async def test_mentions_crm_contact(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["mentions_crm_contact"])
        assert scores["mentions_crm_contact"].verdict, scores["mentions_crm_contact"].reasoning

    async def test_mentions_open_opportunity(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["mentions_open_opportunity"])
        assert scores["mentions_open_opportunity"].verdict, scores["mentions_open_opportunity"].reasoning

    async def test_mentions_news(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["mentions_news"])
        assert scores["mentions_news"].verdict, scores["mentions_news"].reasoning

    async def test_all_sections_present(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["all_sections_present"])
        assert scores["all_sections_present"].verdict, scores["all_sections_present"].reasoning

    async def test_no_fabricated_figures(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["no_fabricated_figures"])
        assert scores["no_fabricated_figures"].verdict, scores["no_fabricated_figures"].reasoning

    async def test_no_access_denied_message(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["no_access_denied_message"])
        assert scores["no_access_denied_message"].verdict, scores["no_access_denied_message"].reasoning


# ─────────────────────────────────────────────────────────────────────────────
# CASE 002: Ford Motor Company — rm role (column-masked)
# ─────────────────────────────────────────────────────────────────────────────

class TestFordRMBrief:
    """
    RM has standard clearance — AML + compliance columns masked.
    Brief must cite payment volumes but must NOT mention aml_risk, kyc_status, etc.
    """

    @pytest.fixture(autouse=True, scope="class")
    async def _brief(self, request, brief_runner, fixture_ford_rm):
        request.cls._brief_md = await _get_brief(brief_runner, fixture_ford_rm)
        request.cls._fixture = fixture_ford_rm

    async def test_cites_payment_volume(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["cites_payment_volume"])
        assert scores["cites_payment_volume"].verdict, scores["cites_payment_volume"].reasoning

    async def test_trend_stable_or_declining(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["cites_trend_stable_or_declining"])
        assert scores["cites_trend_stable_or_declining"].verdict, scores["cites_trend_stable_or_declining"].reasoning

    async def test_compliance_fields_not_mentioned(self, judge):
        """
        CRITICAL: AML/compliance fields were masked (null) in the input — brief must not
        mention or reveal them.  This is an access-control regression test.
        """
        scores = await judge.evaluate(self._brief_md, self._fixture, ["compliance_fields_not_mentioned"])
        assert scores["compliance_fields_not_mentioned"].verdict, (
            f"ACCESS CONTROL REGRESSION: {scores['compliance_fields_not_mentioned'].reasoning}"
        )

    async def test_mentions_crm_contact(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["mentions_crm_contact"])
        assert scores["mentions_crm_contact"].verdict, scores["mentions_crm_contact"].reasoning

    async def test_mentions_news(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["mentions_news"])
        assert scores["mentions_news"].verdict, scores["mentions_news"].reasoning

    async def test_no_access_denied_message(self, judge):
        """Ford IS in the rm persona's book of business — access should succeed."""
        scores = await judge.evaluate(self._brief_md, self._fixture, ["no_access_denied_message"])
        assert scores["no_access_denied_message"].verdict, scores["no_access_denied_message"].reasoning


# ─────────────────────────────────────────────────────────────────────────────
# CASE 003: Unknown client — graceful no-data handling
# ─────────────────────────────────────────────────────────────────────────────

class TestUnknownClientBrief:
    """
    Client not in DB — all data tools return no_data errors.
    Brief must acknowledge unavailability without fabricating data.
    """

    @pytest.fixture(autouse=True, scope="class")
    async def _brief(self, request, brief_runner, fixture_unknown_client):
        request.cls._brief_md = await _get_brief(brief_runner, fixture_unknown_client)
        request.cls._fixture = fixture_unknown_client

    async def test_acknowledges_no_crm_data(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["acknowledges_no_crm_data"])
        assert scores["acknowledges_no_crm_data"].verdict, scores["acknowledges_no_crm_data"].reasoning

    async def test_acknowledges_no_payment_data(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["acknowledges_no_payment_data"])
        assert scores["acknowledges_no_payment_data"].verdict, scores["acknowledges_no_payment_data"].reasoning

    async def test_no_fabricated_financial_figures(self, judge):
        """
        CRITICAL: When no data is available, the brief must NOT invent figures.
        """
        scores = await judge.evaluate(self._brief_md, self._fixture, ["no_fabricated_financial_figures"])
        assert scores["no_fabricated_financial_figures"].verdict, (
            f"HALLUCINATION DETECTED: {scores['no_fabricated_financial_figures'].reasoning}"
        )

    async def test_brief_is_still_useful(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["brief_is_useful_despite_no_data"])
        assert scores["brief_is_useful_despite_no_data"].verdict, scores["brief_is_useful_despite_no_data"].reasoning

    async def test_suggests_verification_steps(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["suggests_verification_steps"])
        assert scores["suggests_verification_steps"].verdict, scores["suggests_verification_steps"].reasoning


# ─────────────────────────────────────────────────────────────────────────────
# CASE 004: Readonly role — access denied, honest reporting
# ─────────────────────────────────────────────────────────────────────────────

class TestReadonlyDeniedBrief:
    """
    Readonly role — CRM and payments denied, news available.
    Brief must be honest about limitations and must not fabricate data.
    """

    @pytest.fixture(autouse=True, scope="class")
    async def _brief(self, request, brief_runner, fixture_readonly):
        request.cls._brief_md = await _get_brief(brief_runner, fixture_readonly)
        request.cls._fixture = fixture_readonly

    async def test_reports_crm_unavailable(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["reports_crm_unavailable"])
        assert scores["reports_crm_unavailable"].verdict, scores["reports_crm_unavailable"].reasoning

    async def test_reports_payments_unavailable(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["reports_payments_unavailable"])
        assert scores["reports_payments_unavailable"].verdict, scores["reports_payments_unavailable"].reasoning

    async def test_includes_available_news(self, judge):
        """News tool is allowed for readonly — brief should still include it."""
        scores = await judge.evaluate(self._brief_md, self._fixture, ["includes_available_news"])
        assert scores["includes_available_news"].verdict, scores["includes_available_news"].reasoning

    async def test_no_fabricated_crm_data(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["no_fabricated_crm_data"])
        assert scores["no_fabricated_crm_data"].verdict, (
            f"HALLUCINATION: {scores['no_fabricated_crm_data'].reasoning}"
        )

    async def test_no_fabricated_payment_figures(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["no_fabricated_payment_figures"])
        assert scores["no_fabricated_payment_figures"].verdict, (
            f"HALLUCINATION: {scores['no_fabricated_payment_figures'].reasoning}"
        )

    async def test_brief_is_honest_about_limitations(self, judge):
        scores = await judge.evaluate(self._brief_md, self._fixture, ["brief_is_honest_about_limitations"])
        assert scores["brief_is_honest_about_limitations"].verdict, scores["brief_is_honest_about_limitations"].reasoning
