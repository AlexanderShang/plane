# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Internal addition (not part of upstream makeplane/plane): workspace-scoped
# Contract master + per-project join, the API side of the Contract /
# ContractProject models added in Phase A. Phase B.1a only needs the read path
# plus a workspace-scoped contract list (no per-project scoping on the contract
# endpoint itself -- contracts are workspace-level, not project-level), and the
# project-links read on the contract detail. ContractProject creation is left
# to the import command and to the planned B.2/B.3 management UI; this PR only
# exposes GET and the ContractProject PATCH for the per-relationship fields
# (allocation_ratio, etc.) that the import command does not need to touch.

# Third-party imports
from rest_framework import status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ContractProjectSerializer, ContractSerializer
from plane.db.models import Contract, ContractProject, ProjectMember
from .base import BaseViewSet


class ContractAccessPermission(BasePermission):
    """Contract data carries financial information (total_amount, tax_rate,
    sign_date). Like ProjectCustomFieldAccessPermission, GUEST-role members
    must not see it, so every method requires ADMIN/MEMBER workspace membership
    rather than just an active session."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return WorkspaceMember.objects.filter(
                workspace__slug=view.kwargs.get("slug"),
                member=request.user,
                role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
                is_active=True,
            ).exists()
        # Mutations: ADMIN-only, since writing financial fields needs explicit
        # authorisation. (The import command bypasses DRF entirely and writes
        # via ORM, so the permission here only gates UI/API callers.)
        return WorkspaceMember.objects.filter(
            workspace__slug=view.kwargs.get("slug"),
            member=request.user,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()


class ContractViewSet(BaseViewSet):
    model = Contract
    permission_classes = [IsAuthenticated, ContractAccessPermission]
    use_read_replica = True

    def get_serializer(self, *args, **kwargs):
        return super().get_serializer(*args, **kwargs)

    def get_queryset(self):
        return Contract.objects.filter(workspace__slug=self.kwargs.get("slug"))

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["workspace_slug"] = self.kwargs.get("slug")
        return context

    def list(self, request, slug):
        # Read path: workspace-scoped list of all contracts. The frontend
        # project-info block will GET this filtered client-side by project_links,
        # but a workspace-level list is the source of truth and supports the
        # planned B.2 Contract-list page without another endpoint.
        contracts = self.get_queryset().order_by("contract_no")
        serializer = ContractSerializer(contracts, many=True, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_200_OK)

    def retrieve(self, request, slug, pk):
        contract = self.get_queryset().filter(pk=pk).first()
        if not contract:
            return Response({"error": "Contract not found"}, status=status.HTTP_404_NOT_FOUND)
        serializer = ContractSerializer(contract, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_200_OK)


# Importing here (not at module top) to avoid a circular import when serializers/
# views modules load each other for type discovery. IsAuthenticated is exported
# from rest_framework.permissions in BaseViewSet's chain; we re-import to make
# the permission_classes tuple on each ViewSet explicit.
from rest_framework.permissions import IsAuthenticated  # noqa: E402


class ContractProjectViewSet(BaseViewSet):
    """Per-project view of the contract-project join rows. Read-only at the
    project level: the import command is the only writer today, and the planned
    B.3 management UI will live on a separate page that talks to a different
    URL prefix."""

    model = ContractProject
    permission_classes = [IsAuthenticated, ContractAccessPermission]
    use_read_replica = True

    def get_queryset(self):
        return ContractProject.objects.filter(
            workspace__slug=self.kwargs.get("slug"),
            project_id=self.kwargs.get("project_id"),
        )

    def list(self, request, slug, project_id):
        links = self.get_queryset().order_by("contract__contract_no")
        serializer = ContractProjectSerializer(links, many=True, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_200_OK)
