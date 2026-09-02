/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): frontend service
 * for the Contract / ContractProject endpoints added in Phase B.1a
 * (apps/api/plane/app/urls/contract.py) and Phase B.2a
 * (apps/api/plane/app/views/contract.py).
 *
 * Read methods (Phase B.1a): listWorkspaceContracts, listProjectContractLinks.
 * Mutating methods (Phase B.2a, exercised by B.2b's settings UI):
 * createContract, updateContract, deleteContract.
 * Per-project link operations (Phase B.3): linkContract, unlinkContract.
 */

import { API_BASE_URL } from "@plane/constants";
import type { IContract, IProjectContractLink } from "@plane/types";
import { APIService } from "@/services/api.service";

/** Shape of the contract_no + financial fields a UI form submits. The
 *  service accepts a plain object so the calling form does not have to
 *  know the IContract transport shape (which includes the read-only
 *  `id`, `workspace_id`, `project_links` fields that the API returns but
 *  the form never submits). */
export type TContractPayload = Partial<
  Pick<
    IContract,
    | "contract_no"
    | "contract_name"
    | "contract_type"
    | "customer"
    | "sign_date"
    | "start_date"
    | "end_date"
    | "total_amount"
    | "tax_rate"
    | "status"
  >
>;

export class ContractService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  /** Workspace-level contract list. Used by the B.2 contract list page
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
   *  Used by the project-info "related contracts" block in Phase B.1b. */
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

  /** Phase B.2a endpoint: POST /workspaces/<slug>/contracts/.
   *  Returns the full IContract payload (including project_links, which
   *  will be [] for a brand-new contract) so the form can navigate to
   *  the detail page without a follow-up GET. */
  async createContract(workspaceSlug: string, payload: TContractPayload): Promise<IContract> {
    return this.post(`/api/workspaces/${workspaceSlug}/contracts/`, payload)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Phase B.2a endpoint: PATCH /workspaces/<slug>/contracts/<uuid>/.
   *  contract_no is intentionally absent from TContractPayload so the
   *  form cannot accidentally send a different value to rename a
   *  contract's identity (the backend's ContractUpdateSerializer also
   *  drops it -- defense in depth). */
  async updateContract(
    workspaceSlug: string,
    contractId: string,
    payload: TContractPayload
  ): Promise<IContract> {
    return this.patch(`/api/workspaces/${workspaceSlug}/contracts/${contractId}/`, payload)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Phase B.2a endpoint: DELETE /workspaces/<slug>/contracts/<uuid>/.
   *  Cascades to ContractProject rows server-side (Contract.delete() ->
   *  ContractProject.on_delete=CASCADE), so the UI does not have to chase
   *  the affected project_links manually. */
  async deleteContract(workspaceSlug: string, contractId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/contracts/${contractId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Phase B.3 endpoint: POST /workspaces/<slug>/projects/<uuid>/contracts/.
   *  The payload must include `contract` (the contract id) and
   *  `allocation_ratio` (0-1, optional) per the ContractProject model. */
  async linkContract(
    workspaceSlug: string,
    projectId: string,
    payload: { contract: string; allocation_ratio?: string; relation_type?: string; relation_role?: string }
  ): Promise<IProjectContractLink> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/contracts/`, payload)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Phase B.3 endpoint: DELETE /workspaces/<slug>/projects/<uuid>/contracts/<pk>/.
   *  The path uses the link-row's id (returned by listProjectContractLinks),
   *  not the contract id, because a contract can be linked to multiple
   *  projects and the URL identifies the (contract, project) pair, not the
   *  contract alone. */
  async unlinkContract(
    workspaceSlug: string,
    projectId: string,
    linkId: string
  ): Promise<void> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/contracts/${linkId}/`
    )
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
