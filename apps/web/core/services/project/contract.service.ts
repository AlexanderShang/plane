/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): frontend service
 * for the Contract / ContractProject endpoints added in Phase B.1a
 * (apps/api/plane/app/urls/contract.py). Read-only in this phase: the import
 * command (apps/api/plane/db/management/commands/import_historical_project_data.py)
 * is the only writer of Contract / ContractProject rows today. Phase B.2/B.3
 * will add the mutating methods when the contract management UI lands.
 */

import { API_BASE_URL } from "@plane/constants";
import type { IContract, IProjectContractLink } from "@plane/types";
import { APIService } from "@/services/api.service";

export class ContractService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  /** Workspace-level contract list. Used by the planned B.2 contract list page
   *  and, in B.1b, by the project-info "related contracts" block (which fetches
   *  the full list and filters client-side by project_links). The endpoint
   *  intentionally does not paginate in this phase: a typical deployment has
   *  tens to low-hundreds of contracts, and the in-memory filter is cheap. If
   *  real workloads ever push past a few thousand contracts, add `?page=` and
   *  push the per-project filter to the server. */
  async listWorkspaceContracts(workspaceSlug: string): Promise<IContract[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/contracts/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Per-project view of the join rows: which contracts cover THIS project.
   *  This is the smaller, project-scoped endpoint that B.1b's
   *  "related-contracts" block prefers when it doesn't need other contracts'
   *  metadata. */
  async listProjectContractLinks(
    workspaceSlug: string,
    projectId: string
  ): Promise<IProjectContractLink[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/contracts/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
