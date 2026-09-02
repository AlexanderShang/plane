# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Internal addition (not part of upstream makeplane/plane): model-level tests for
# the Contract / ContractProject pair introduced in Phase A
# (apps/api/plane/db/models/contract.py). Skips the DRF view stack: this file
# only exercises the invariants the import command and serializers depend on, so
# the same tests run with the same result whether invoked via the test runner or
# the import_historical_project_data management command's test profile.

import pytest
from uuid import uuid4

from plane.db.models import Contract, ContractProject, Project, Workspace


@pytest.mark.unit
class TestContractModel:
    @pytest.mark.django_db
    def test_contract_unique_per_workspace(self, create_user):
        """The DB UniqueConstraint(workspace, contract_no) is the whole reason
        Contract.get_or_create(workspace=..., contract_no=...) is safe: a
        duplicate import can never produce two Contract rows for the same
        contract number within a workspace. The test asserts the constraint
        fires at the DB level rather than relying on a serializer."""
        workspace = Workspace.objects.create(
            name="Test WS", slug=f"test-{uuid4().hex[:8]}", id=uuid4(), owner=create_user
        )
        Contract.objects.create(workspace=workspace, contract_no="HT2026-001")
        # Soft-deleted rows are excluded by the UniqueConstraint's condition, so a
        # same-number row with deleted_at set is allowed (and out of scope here).
        with pytest.raises(Exception):
            Contract.objects.create(workspace=workspace, contract_no="HT2026-001")

    @pytest.mark.django_db
    def test_contract_isolated_across_workspaces(self, create_user):
        """The UniqueConstraint is per-workspace: two workspaces may both
        legitimately hold a contract numbered HT2026-001. This is the inverse
        of the test above and guards against a future migration accidentally
        making the constraint workspace-agnostic."""
        ws_a = Workspace.objects.create(
            name="A", slug=f"a-{uuid4().hex[:8]}", id=uuid4(), owner=create_user
        )
        ws_b = Workspace.objects.create(
            name="B", slug=f"b-{uuid4().hex[:8]}", id=uuid4(), owner=create_user
        )
        Contract.objects.create(workspace=ws_a, contract_no="HT2026-001")
        # Same contract_no, different workspace: must succeed.
        Contract.objects.create(workspace=ws_b, contract_no="HT2026-001")


@pytest.mark.unit
class TestContractProjectModel:
    @pytest.mark.django_db
    def test_contract_project_unique_per_pair(self, create_user):
        """UniqueConstraint(contract, project): the same contract cannot be
        linked to the same project twice. The import command relies on this for
        the "this row already linked" skip path (ContractProject.get_or_create)."""
        workspace = Workspace.objects.create(
            name="Test WS", slug=f"test-{uuid4().hex[:8]}", id=uuid4(), owner=create_user
        )
        contract = Contract.objects.create(workspace=workspace, contract_no="HT2026-001")
        project = Project.objects.create(
            name="Test Project",
            identifier=f"PRJ{uuid4().hex[:6]}",
            workspace=workspace,
            created_by=create_user,
        )
        ContractProject.objects.create(contract=contract, project=project, workspace=workspace)
        with pytest.raises(Exception):
            ContractProject.objects.create(contract=contract, project=project, workspace=workspace)
