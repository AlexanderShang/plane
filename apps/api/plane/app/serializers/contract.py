# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Internal addition (not part of upstream makeplane/plane): the contract half of
# the historical contract/delivery tracking spreadsheet this Plane deployment
# replaces. Contract is a workspace-scoped master; ContractProject is the join
# table. See docs/internal-contract-project-relationship.md for the design and
# docs/internal-contract-project-relationship-implementation-2026-09.md for the
# Phase A implementation record.

# Third-party imports
from rest_framework import serializers

# Module imports
from plane.db.models import Contract, ContractProject
from .base import BaseSerializer


class ContractSerializer(BaseSerializer):
    # Read-only link table to the projects that reference this contract. The M:N
    # shape (one contract → many projects) is the whole reason this model exists
    # separately from ProjectCustomField; exposing it on the contract read makes
    # the "which projects does this contract cover" question answerable in a single
    # GET without forcing the frontend to fan out to a separate endpoint.
    project_links = serializers.SerializerMethodField()

    class Meta:
        model = Contract
        fields = [
            "id",
            "contract_no",
            "contract_name",
            "contract_type",
            "customer",
            "sign_date",
            "start_date",
            "end_date",
            "total_amount",
            "tax_rate",
            "status",
            "workspace_id",
            "project_links",
        ]
        # workspace is set by the view from the URL slug; contract_no is the
        # business identifier and uniqueness is enforced by a DB constraint
        # rather than a serializer-level check, so neither needs to be writable.
        read_only_fields = ["workspace", "contract_no"]

    def get_project_links(self, obj):
        # Annotate-free read path: the project-info page is read-mostly and the
        # link table is small per contract. If a contract ever has thousands of
        # project links this should switch to a prefetch + .values() so the
        # N+1 doesn't matter.
        return [
            {
                "id": link.id,
                "project_id": link.project_id,
                "allocation_ratio": link.allocation_ratio,
                "relation_type": link.relation_type,
                "relation_role": link.relation_role,
            }
            for link in obj.project_links.all()
        ]


class ContractProjectSerializer(BaseSerializer):
    class Meta:
        model = ContractProject
        fields = [
            "id",
            "contract",
            "project",
            "allocation_ratio",
            "relation_type",
            "relation_role",
            "allocated_amount",
            "scope_description",
            "start_date",
            "end_date",
            "status",
            "remark",
            "workspace_id",
        ]
        # The (contract, project) pair is the join's identity: enforced by a DB
        # UniqueConstraint, so the FK fields are read-only on update. workspace is
        # auto-populated from project on save() (ProjectBaseModel contract).
        read_only_fields = ["workspace", "contract", "project"]

    def validate_allocation_ratio(self, value):
        # DecimalField rejects <0 implicitly via the schema; this is just the
        # upper bound. 1.0 (100%) is allowed because some contracts are wholly
        # allocated to a single project, but anything above is almost certainly a
        # data-entry error from someone typing a percentage as a 0-100 integer
        # when the column expects 0-1.
        if value is not None and value > 1:
            raise serializers.ValidationError(detail="ALLOCATION_RATIO_OUT_OF_RANGE")
        return value


class ContractCreateSerializer(BaseSerializer):
    """Write payload for POST /workspaces/<slug>/contracts/. workspace is
    resolved from the URL slug by the view's perform_create; contract_no is
    set by the user (it's the business identifier) and uniqueness against the
    workspace's other rows is enforced by the DB UniqueConstraint. The view
    catches IntegrityError and re-raises as a 400 with CONFLICT_CONTRACT_NO
    so the frontend can show a meaningful toast."""

    class Meta:
        model = Contract
        fields = [
            "contract_no",
            "contract_name",
            "contract_type",
            "customer",
            "sign_date",
            "start_date",
            "end_date",
            "total_amount",
            "tax_rate",
            "status",
        ]


class ContractUpdateSerializer(BaseSerializer):
    """Write payload for PATCH /workspaces/<slug>/contracts/<uuid>/. contract_no
    is intentionally omitted from `fields`: the business identifier is
    immutable after creation so a UI that accidentally sends the original
    contract_no still works (it's ignored), and so a UI that sends a different
    contract_no does not silently rename a contract's identity. Changing the
    identity, if ever needed, is a separate destroy+create flow."""

    class Meta:
        model = Contract
        fields = [
            "contract_name",
            "contract_type",
            "customer",
            "sign_date",
            "start_date",
            "end_date",
            "total_amount",
            "tax_rate",
            "status",
        ]
