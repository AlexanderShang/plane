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
from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    ContractCreateSerializer,
    ContractProjectSerializer,
    ContractSerializer,
    ContractUpdateSerializer,
)
from plane.db.models import Contract, ContractProject, WorkspaceMember
from .base import BaseViewSet


class ContractAccessPermission(BasePermission):
    """Contract data carries financial information (total_amount, tax_rate,
    sign_date). Like ProjectCustomFieldAccessPermission, GUEST-role members
    must not see it, so every method requires ADMIN/MEMBER workspace membership
    rather than just an active session."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        # Match the pattern used by ProjectCustomFieldAccessPermission: read
        # the workspace from the BaseViewSet-managed `view.workspace_slug` property
        # rather than digging into view.kwargs directly. Future changes to the
        # URL kwarg name (e.g. `<str:slug>` -> `<str:workspace_slug>`) will then
        # # keep working without silent permission failures.
        workspace_slug = view.workspace_slug
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return WorkspaceMember.objects.filter(
                workspace__slug=workspace_slug,
                member=request.user,
                role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
                is_active=True,
            ).exists()
        # Mutations: ADMIN-only, since writing financial fields needs explicit
        # authorisation. (The import command bypasses DRF entirely and writes
        # via ORM, so the permission here only gates UI/API callers.)
        return WorkspaceMember.objects.filter(
            workspace__slug=workspace_slug,
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
        # prefetch_related avoids the N+1 that ContractSerializer.get_project_links
        # would otherwise trigger: a workspace with 200 contracts each linked to
        # 5 projects would have produced 200 extra queries without this. The
        # retrieve() path benefits too (one contract, one extra query normally).
        return Contract.objects.filter(workspace__slug=self.kwargs.get("slug")).prefetch_related("project_links")

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

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def create(self, request, slug):
        # contract_no uniqueness against the workspace is enforced by a DB
        # UniqueConstraint. We catch IntegrityError here and translate it to
        # a 400 with a stable error code so the frontend can show a meaningful
        # toast without having to introspect a 500 stack trace.
        serializer = ContractCreateSerializer(data=request.data, context={"workspace_slug": slug})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                contract = serializer.save(workspace_id=self._workspace_id_from_slug(slug))
        except IntegrityError:
            return Response(
                {"error": "CONFLICT_CONTRACT_NO", "detail": "A contract with this contract_no already exists in this workspace."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Reload with prefetch so ContractSerializer.get_project_links does
        # not trigger an extra query for the response payload. The brand-new
        # contract has no project_links yet, so this is one query with zero
        # rows -- small -- but it keeps the create path symmetric with the
        # list/retrieve paths which already pay the prefetch cost.
        contract = Contract.objects.prefetch_related("project_links").get(pk=contract.pk)
        return Response(ContractSerializer(contract, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        contract = self.get_queryset().filter(pk=pk).first()
        if not contract:
            return Response({"error": "Contract not found"}, status=status.HTTP_404_NOT_FOUND)
        serializer = ContractUpdateSerializer(contract, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(ContractSerializer(contract, context=self.get_serializer_context()).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        # ContractProject rows reference Contract with on_delete=CASCADE on
        # the related_name='project_links' FK, so deleting a contract removes
        # its links in the same transaction. No frontend or admin cleanup
        # step is required.
        contract = self.get_queryset().filter(pk=pk).first()
        if not contract:
            return Response({"error": "Contract not found"}, status=status.HTTP_404_NOT_FOUND)
        contract.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _workspace_id_from_slug(self, slug):
        # Resolve the workspace id from the URL slug + session user on every
        # call. Caching on `self` is unsafe: ViewSet instances are typically
        # per-request, but DRF's view-caching infrastructure (and a future
        # `@cache_response` decorator) can share an instance across requests,
        # which would let request N see request N-1's workspace_id -- an
        # authorization footgun. The lookup is a single indexed query, so
        # repeat calls are cheap enough not to cache.
        return WorkspaceMember.objects.filter(
            workspace__slug=slug, member=self.request.user, is_active=True
        ).values_list("workspace_id", flat=True).first()


# ContractProjectViewSet follows the same pattern as ContractViewSet above
# (top-level IsAuthenticated import, view.workspace_slug-based permission).
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
