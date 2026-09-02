# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Integration tests for the ContractViewSet write endpoints (Phase B.2a).
Covers create / partial_update / destroy on /workspaces/<slug>/contracts/ and
the admin-only permission gate (ContractAccessPermission).
"""
# This is a unit-level test, not a contract/ test, because the fixtures it
# needs (create_user, session_client) are scoped to the unit suite in
# apps/api/plane/tests/conftest.py. End-to-end URL routing smoke lives in the
# independent test environment per docs/contract-project-test-guide.md.

import pytest
from rest_framework import status

from plane.db.models import Contract, ContractProject, Workspace, WorkspaceMember


@pytest.mark.unit
@pytest.mark.django_db
class TestContractViewSetCreate:
    """POST /api/workspaces/<slug>/contracts/"""

    def _make_admin_workspace(self, user):
        ws = Workspace.objects.create(
            name="Test WS", slug=f"ws-{user.id.hex[:8]}", owner=user
        )
        WorkspaceMember.objects.create(workspace=ws, member=user, role=20, is_active=True)  # ADMIN
        return ws

    def test_create_contract_happy_path(self, session_client, create_user):
        ws = self._make_admin_workspace(create_user)
        url = f"/api/workspaces/{ws.slug}/contracts/"
        response = session_client.post(
            url,
            data={
                "contract_no": "HT2026-NEW-001",
                "contract_name": "Acme SaaS agreement",
                "customer": "Acme",
                "sign_date": "2026-01-15",
                "total_amount": "100.0000",
                "tax_rate": "0.1300",
                "status": "active",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["contract_no"] == "HT2026-NEW-001"
        assert response.data["workspace_id"] == str(ws.id)
        # Round-trip through the DB to confirm save() actually committed.
        assert Contract.objects.filter(workspace=ws, contract_no="HT2026-NEW-001").exists()

    def test_create_contract_duplicate_contract_no_returns_400(self, session_client, create_user):
        """The DB UniqueConstraint on (workspace, contract_no) must surface as
        a 400 with a stable error code the frontend can match on, not a 500."""
        ws = self._make_admin_workspace(create_user)
        url = f"/api/workspaces/{ws.slug}/contracts/"
        first = session_client.post(url, data={"contract_no": "HT2026-DUP"}, format="json")
        assert first.status_code == status.HTTP_201_CREATED
        second = session_client.post(url, data={"contract_no": "HT2026-DUP"}, format="json")
        assert second.status_code == status.HTTP_400_BAD_REQUEST
        assert second.data["error"] == "CONFLICT_CONTRACT_NO"

    def test_create_contract_member_role_is_forbidden(self, session_client, create_user):
        """ContractAccessPermission allows read for MEMBER but not write --
        a MEMBER-role user must be 403 on POST."""
        ws = Workspace.objects.create(name="WS", slug=f"ws-{create_user.id.hex[:8]}", owner=create_user)
        WorkspaceMember.objects.create(workspace=ws, member=create_user, role=15, is_active=True)  # MEMBER
        url = f"/api/workspaces/{ws.slug}/contracts/"
        response = session_client.post(url, data={"contract_no": "HT2026-NO"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.unit
@pytest.mark.django_db
class TestContractViewSetUpdate:
    """PATCH /api/workspaces/<slug>/contracts/<uuid>/"""

    def test_partial_update_changes_name(self, session_client, create_user):
        ws = Workspace.objects.create(name="WS", slug=f"ws-{create_user.id.hex[:8]}", owner=create_user)
        WorkspaceMember.objects.create(workspace=ws, member=create_user, role=20, is_active=True)
        contract = Contract.objects.create(workspace=ws, contract_no="HT2026-UP-1", contract_name="Old")
        url = f"/api/workspaces/{ws.slug}/contracts/{contract.id}/"
        response = session_client.patch(url, data={"contract_name": "New"}, format="json")
        assert response.status_code == status.HTTP_200_OK
        contract.refresh_from_db()
        assert contract.contract_name == "New"
        # contract_no must remain unchanged: it is the business identifier and
        # ContractUpdateSerializer does not expose it as a writable field.
        assert contract.contract_no == "HT2026-UP-1"

    def test_partial_update_404_for_missing_contract(self, session_client, create_user):
        ws = Workspace.objects.create(name="WS", slug=f"ws-{create_user.id.hex[:8]}", owner=create_user)
        WorkspaceMember.objects.create(workspace=ws, member=create_user, role=20, is_active=True)
        url = f"/api/workspaces/{ws.slug}/contracts/00000000-0000-0000-0000-000000000000/"
        response = session_client.patch(url, data={"contract_name": "x"}, format="json")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.unit
@pytest.mark.django_db
class TestContractViewSetDestroy:
    """DELETE /api/workspaces/<slug>/contracts/<uuid>/"""

    def test_destroy_cascades_to_project_links(self, session_client, create_user):
        """ContractProject.on_delete=CASCADE should remove the link rows when
        the parent Contract is deleted -- the import command relies on the
        same CASCADE to keep the join table consistent with the master."""
        from plane.tests.factories import ProjectFactory

        ws = Workspace.objects.create(name="WS", slug=f"ws-{create_user.id.hex[:8]}", owner=create_user)
        WorkspaceMember.objects.create(workspace=ws, member=create_user, role=20, is_active=True)
        project = ProjectFactory(workspace=ws, created_by=create_user)
        contract = Contract.objects.create(workspace=ws, contract_no="HT2026-DEL-1")
        link = ContractProject.objects.create(contract=contract, project=project, workspace=ws, allocation_ratio="1.0000")
        assert ContractProject.objects.filter(pk=link.pk).exists()

        url = f"/api/workspaces/{ws.slug}/contracts/{contract.id}/"
        response = session_client.delete(url)
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Contract.objects.filter(pk=contract.pk).exists()
        assert not ContractProject.objects.filter(pk=link.pk).exists()
