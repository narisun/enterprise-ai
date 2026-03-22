"""
Unit tests for platform_sdk.auth — AgentContext HMAC/JWT wire format,
row-level filters, and column-level masking.

No external dependencies: no DB, no HTTP, no LLM.
"""
import os
import time

import pytest

# Force deterministic secrets for all unit tests.
# Use direct assignment (not setdefault) so that values from .env loaded by
# pytest-dotenv are overridden — unit tests must not depend on .env contents.
os.environ["JWT_SECRET"] = "unit-test-jwt-secret"
os.environ["CONTEXT_HMAC_SECRET"] = "unit-test-hmac-secret"

from platform_sdk.auth import (  # noqa: E402
    AgentContext,
    _AML_COLUMNS,
    _COMPLIANCE_COLUMNS,
)

pytestmark = pytest.mark.unit

# ── Fixtures ───────────────────────────────────────────────────────────────────

def _make_ctx(**overrides) -> AgentContext:
    defaults = dict(
        rm_id="rm-001",
        rm_name="Test RM",
        role="rm",
        team_id="team-1",
        assigned_account_ids=("001AAA", "002AAA"),
        compliance_clearance=("standard",),
    )
    defaults.update(overrides)
    return AgentContext(**defaults)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1: HMAC wire format round-trips
# ─────────────────────────────────────────────────────────────────────────────

class TestHmacWireFormat:
    def test_roundtrip_manager(self):
        ctx = _make_ctx(role="manager", compliance_clearance=("standard", "aml_view", "compliance_full"))
        header = ctx.to_header_value()
        restored = AgentContext.from_header(header)
        assert restored == ctx

    def test_roundtrip_rm_with_accounts(self):
        ctx = _make_ctx(role="rm", assigned_account_ids=("001AAA", "002BBB"))
        restored = AgentContext.from_header(ctx.to_header_value())
        assert restored.assigned_account_ids == ("001AAA", "002BBB")
        assert restored.role == "rm"

    def test_roundtrip_preserves_clearance(self):
        ctx = _make_ctx(compliance_clearance=("standard", "aml_view"))
        restored = AgentContext.from_header(ctx.to_header_value())
        assert set(restored.compliance_clearance) == {"standard", "aml_view"}

    def test_tampered_payload_raises(self):
        ctx = _make_ctx()
        header = ctx.to_header_value()
        payload_b64, sig = header.split(".")
        # flip one byte in the payload
        tampered = payload_b64[:-2] + ("AA" if payload_b64[-2:] != "AA" else "BB")
        with pytest.raises(ValueError, match="HMAC"):
            AgentContext.from_header(f"{tampered}.{sig}")

    def test_wrong_signature_raises(self):
        ctx = _make_ctx()
        header = ctx.to_header_value()
        payload_b64, _ = header.split(".")
        with pytest.raises(ValueError, match="HMAC"):
            AgentContext.from_header(f"{payload_b64}.deadbeef")

    def test_missing_separator_raises(self):
        with pytest.raises(ValueError, match="segment count"):
            AgentContext.from_header("notasignedheader")

    def test_extra_segments_raises(self):
        with pytest.raises(ValueError, match="segment count"):
            AgentContext.from_header("a.b.c")

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            AgentContext.from_header("")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2: JWT round-trips
# ─────────────────────────────────────────────────────────────────────────────

class TestJwtRoundTrip:
    def test_roundtrip_manager(self):
        import jwt as pyjwt
        ctx = _make_ctx(
            role="manager",
            compliance_clearance=("standard", "aml_view", "compliance_full"),
            assigned_account_ids=(),
        )
        payload = {
            "sub":                  ctx.rm_id,
            "name":                 ctx.rm_name,
            "role":                 ctx.role,
            "team_id":              ctx.team_id,
            "assigned_account_ids": list(ctx.assigned_account_ids),
            "compliance_clearance": list(ctx.compliance_clearance),
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        }
        token = pyjwt.encode(payload, "unit-test-jwt-secret", algorithm="HS256")
        restored = AgentContext.from_jwt(token)
        assert restored.role == "manager"
        assert "compliance_full" in restored.compliance_clearance

    def test_expired_jwt_raises(self):
        import jwt as pyjwt
        payload = {
            "sub": "x", "name": "x", "role": "rm", "team_id": "",
            "assigned_account_ids": [], "compliance_clearance": ["standard"],
            "iat": int(time.time()) - 7200,
            "exp": int(time.time()) - 3600,   # already expired
        }
        token = pyjwt.encode(payload, "unit-test-jwt-secret", algorithm="HS256")
        with pytest.raises(Exception):  # pyjwt raises ExpiredSignatureError
            AgentContext.from_jwt(token)

    def test_wrong_secret_raises(self):
        import jwt as pyjwt
        payload = {
            "sub": "x", "name": "x", "role": "rm", "team_id": "",
            "assigned_account_ids": [], "compliance_clearance": ["standard"],
            "iat": int(time.time()), "exp": int(time.time()) + 3600,
        }
        token = pyjwt.encode(payload, "wrong-secret", algorithm="HS256")
        with pytest.raises(Exception):
            AgentContext.from_jwt(token)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3: anonymous() is minimum-privilege
# ─────────────────────────────────────────────────────────────────────────────

class TestAnonymousContext:
    def test_role_is_readonly(self):
        assert AgentContext.anonymous().role == "readonly"

    def test_no_assigned_accounts(self):
        assert AgentContext.anonymous().assigned_account_ids == ()

    def test_clearance_is_standard_only(self):
        assert AgentContext.anonymous().compliance_clearance == ("standard",)

    def test_cannot_access_any_account(self):
        anon = AgentContext.anonymous()
        assert anon.can_access_account("001AAA") is False

    def test_hmac_roundtrip(self):
        """anonymous() must survive the HMAC wire round-trip."""
        anon = AgentContext.anonymous()
        restored = AgentContext.from_header(anon.to_header_value())
        assert restored.role == "readonly"


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4: Column masking per clearance level
# ─────────────────────────────────────────────────────────────────────────────

class TestColumnMask:
    """
    Clearance matrix:
      standard       → mask AML + compliance columns  (highest restriction)
      aml_view       → mask only compliance columns
      compliance_full → no masking
    """

    def test_standard_masks_all_sensitive(self):
        ctx = _make_ctx(compliance_clearance=("standard",))
        mask = set(ctx.build_col_mask())
        assert _AML_COLUMNS.issubset(mask), "AML columns must be masked at standard clearance"
        assert _COMPLIANCE_COLUMNS.issubset(mask), "Compliance columns must be masked at standard clearance"

    def test_aml_view_unmasks_aml_but_keeps_compliance(self):
        ctx = _make_ctx(compliance_clearance=("standard", "aml_view"))
        mask = set(ctx.build_col_mask())
        assert not (_AML_COLUMNS & mask), "AML columns must be VISIBLE at aml_view clearance"
        assert _COMPLIANCE_COLUMNS.issubset(mask), "Compliance columns must still be masked at aml_view"

    def test_compliance_full_no_mask(self):
        ctx = _make_ctx(compliance_clearance=("standard", "aml_view", "compliance_full"))
        assert ctx.build_col_mask() == [], "compliance_full must produce empty mask"

    def test_readonly_same_as_standard(self):
        readonly = _make_ctx(role="readonly", compliance_clearance=("standard",), assigned_account_ids=())
        standard_rm = _make_ctx(role="rm", compliance_clearance=("standard",))
        assert set(readonly.build_col_mask()) == set(standard_rm.build_col_mask())

    def test_manager_with_full_clearance_no_mask(self):
        manager = _make_ctx(
            role="manager",
            compliance_clearance=("standard", "aml_view", "compliance_full"),
            assigned_account_ids=(),
        )
        assert manager.build_col_mask() == []

    @pytest.mark.parametrize("col", list(_AML_COLUMNS))
    def test_aml_columns_masked_at_standard(self, col):
        ctx = _make_ctx(compliance_clearance=("standard",))
        assert col in ctx.build_col_mask()

    @pytest.mark.parametrize("col", list(_COMPLIANCE_COLUMNS))
    def test_compliance_columns_masked_at_aml_view(self, col):
        ctx = _make_ctx(compliance_clearance=("standard", "aml_view"))
        assert col in ctx.build_col_mask()


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 5: Row-level filters — CRM
# ─────────────────────────────────────────────────────────────────────────────

class TestRowFiltersCrm:
    def test_manager_no_restriction(self):
        ctx = _make_ctx(role="manager", assigned_account_ids=())
        assert ctx.build_row_filters_crm() == {}

    def test_compliance_officer_no_restriction(self):
        ctx = _make_ctx(role="compliance_officer", assigned_account_ids=())
        assert ctx.build_row_filters_crm() == {}

    def test_senior_rm_no_restriction(self):
        ctx = _make_ctx(role="senior_rm", assigned_account_ids=())
        assert ctx.build_row_filters_crm() == {}

    def test_rm_with_accounts_returns_list(self):
        ctx = _make_ctx(role="rm", assigned_account_ids=("001AAA", "002BBB"))
        filters = ctx.build_row_filters_crm()
        assert set(filters["Account"]) == {"001AAA", "002BBB"}

    def test_rm_no_accounts_deny_all(self):
        ctx = _make_ctx(role="rm", assigned_account_ids=())
        filters = ctx.build_row_filters_crm()
        assert filters == {"Account": ["__DENY_ALL__"]}

    def test_readonly_no_accounts_deny_all(self):
        ctx = _make_ctx(role="readonly", assigned_account_ids=())
        filters = ctx.build_row_filters_crm()
        assert filters == {"Account": ["__DENY_ALL__"]}


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 6: Row-level filters — Payments
# ─────────────────────────────────────────────────────────────────────────────

class TestRowFiltersPayments:
    def test_manager_no_restriction(self):
        ctx = _make_ctx(role="manager", assigned_account_ids=())
        assert ctx.build_row_filters_payments(["Microsoft Corp."]) == {}

    def test_senior_rm_no_restriction(self):
        ctx = _make_ctx(role="senior_rm", assigned_account_ids=())
        assert ctx.build_row_filters_payments(["Microsoft Corp."]) == {}

    def test_rm_with_party_names(self):
        ctx = _make_ctx(role="rm", assigned_account_ids=("001AAA",))
        filters = ctx.build_row_filters_payments(["Microsoft Corp."])
        assert filters["fact_payments"] == ["Microsoft Corp."]
        assert filters["dim_party"] == ["Microsoft Corp."]

    def test_rm_without_party_names_deny_all(self):
        ctx = _make_ctx(role="rm", assigned_account_ids=("001AAA",))
        filters = ctx.build_row_filters_payments(party_names=None)
        assert filters == {"fact_payments": ["__DENY_ALL__"]}

    def test_rm_empty_party_list_deny_all(self):
        ctx = _make_ctx(role="rm", assigned_account_ids=("001AAA",))
        filters = ctx.build_row_filters_payments(party_names=[])
        assert filters == {"fact_payments": ["__DENY_ALL__"]}

    def test_readonly_without_party_names_deny_all(self):
        ctx = _make_ctx(role="readonly", assigned_account_ids=())
        assert ctx.build_row_filters_payments() == {"fact_payments": ["__DENY_ALL__"]}


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 7: can_access_account + has_clearance helpers
# ─────────────────────────────────────────────────────────────────────────────

class TestAccessHelpers:
    def test_manager_can_access_any_account(self):
        ctx = _make_ctx(role="manager", assigned_account_ids=())
        assert ctx.can_access_account("any-random-id") is True

    def test_rm_can_access_assigned(self):
        ctx = _make_ctx(role="rm", assigned_account_ids=("001AAA", "002BBB"))
        assert ctx.can_access_account("001AAA") is True

    def test_rm_cannot_access_unassigned(self):
        ctx = _make_ctx(role="rm", assigned_account_ids=("001AAA",))
        assert ctx.can_access_account("003CCC") is False

    def test_has_clearance_present(self):
        ctx = _make_ctx(compliance_clearance=("standard", "aml_view"))
        assert ctx.has_clearance("aml_view") is True

    def test_has_clearance_absent(self):
        ctx = _make_ctx(compliance_clearance=("standard",))
        assert ctx.has_clearance("compliance_full") is False

    def test_role_rank_ordering(self):
        from platform_sdk.auth import ROLE_RANK
        assert ROLE_RANK["readonly"] < ROLE_RANK["rm"]
        assert ROLE_RANK["rm"] < ROLE_RANK["senior_rm"]
        assert ROLE_RANK["senior_rm"] <= ROLE_RANK["manager"]
