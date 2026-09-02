/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): the contract half of
 * the historical contract/delivery tracking spreadsheet this Plane deployment
 * replaces. See docs/internal-contract-project-relationship.md for the design
 * and docs/internal-contract-project-relationship-implementation-2026-09.md for
 * the Phase A implementation record.
 *
 * Backend source of truth: apps/api/plane/db/models/contract.py and the matching
 * apps/api/plane/app/serializers/contract.py / views/contract.py. Field names
 * mirror the DRF serializer output so the frontend can consume the API
 * directly without renaming.
 */

/** A single contract master row. Workspace-scoped, so the same contract_no
 *  may legitimately appear in two workspaces. contract_no is the user-facing
 *  identifier and is set by the import command (apps/api/plane/db/management/
 *  commands/import_historical_project_data.py); the frontend is read-only here
 *  in Phase B.1 and never creates or edits a Contract. */
export interface IContract {
  id: string;
  contract_no: string;
  contract_name: string;
  contract_type: string;
  customer: string;
  /** ISO date string (YYYY-MM-DD), the DRF DateField default JSON representation. */
  sign_date: string | null;
  start_date: string | null;
  end_date: string | null;
  /** DRF DecimalField serialises as a string to avoid float precision loss when
   *  the value is summed or compared client-side (e.g. on the planned B.2
   *  Contract list page). */
  total_amount: string | null;
  tax_rate: string | null;
  status: string;
  workspace_id: string;
  /** Read-through from the contract detail endpoint: which Plane projects this
   *  contract covers. Empty array means "no projects linked", which is
   *  legitimate for the Phase A-imported placeholder contracts (暂无/待签约)
   *  and for any contract that's been added but not yet assigned. */
  project_links: IContractProjectLink[];
}

/** The M:N join row's per-relationship fields, inlined on the contract detail
 *  payload so the contract page answers "which projects does this contract
 *  cover" in a single round trip. */
export interface IContractProjectLink {
  id: string;
  project_id: string;
  allocation_ratio: string | null;
  relation_type: string;
  relation_role: string;
}

/** The same join row, served by the per-project endpoint. Identical shape
 *  to IContractProjectLink minus the parent contract's id, which the
 *  frontend does not need at the project side because the project is
 *  already known from the URL. */
export interface IProjectContractLink extends Omit<IContractProjectLink, "id"> {
  id: string;
  contract: string;
  project: string;
  allocated_amount: string | null;
  scope_description: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  remark: string;
  workspace_id: string;
}
