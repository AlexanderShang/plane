# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import ContractProjectViewSet, ContractViewSet


urlpatterns = [
    # Workspace-scoped contract list / detail. Contracts live at the workspace
    # level (one contract_no per workspace, UniqueConstraint(workspace, contract_no)),
    # not per-project, so the URL prefix is /workspaces/<slug>/contracts/...
    path(
        "workspaces/<str:slug>/contracts/",
        ContractViewSet.as_view({"get": "list"}),
        name="workspace-contracts",
    ),
    path(
        "workspaces/<str:slug>/contracts/<uuid:pk>/",
        ContractViewSet.as_view({"get": "retrieve"}),
        name="workspace-contract",
    ),
    # Per-project read of the join rows: which contracts cover THIS project.
    # Used by the project-info "相关合同" block in Phase B.1b.
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/contracts/",
        ContractProjectViewSet.as_view({"get": "list"}),
        name="project-contract-links",
    ),
]
