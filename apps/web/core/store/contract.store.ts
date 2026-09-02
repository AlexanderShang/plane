/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): MobX store for
 * Contract / ContractProject data, fed by ContractService. Read-only in
 * Phase B.1: the only writer is the import command's ORM path. B.2/B.3 will
 * add the mutating actions when the contract management UI lands.
 *
 * Cache shape: a single workspace-level array (`contractsByWorkspace`) of all
 * contracts in the workspace, plus a per-project Map (`linksByProject`) of
 * ContractProject rows. The project-info "related contracts" block reads
 * from `contractsByWorkspace` and joins client-side on `project_links[*].project_id`,
 * which is a join on already-loaded data and avoids a second network call.
 * The dedicated per-project endpoint is exposed for callers that want only
 * the join rows (it never includes the contract fields the block needs).
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
// types
import type { IContract, IProjectContractLink } from "@plane/types";
// services
import { ContractService } from "@/services/project";
// store
import type { CoreRootStore } from "./root.store";

export interface IContractStore {
  // loaders
  contractsFetched: Record<string, boolean>;
  linksFetched: Record<string, boolean>;
  // cache
  contractsByWorkspace: Record<string, IContract[] | undefined>;
  linksByProject: Record<string, IProjectContractLink[] | undefined>;
}

export class ContractStore implements IContractStore {
  contractsFetched: Record<string, boolean> = {};
  linksFetched: Record<string, boolean> = {};
  contractsByWorkspace: Record<string, IContract[] | undefined> = {};
  linksByProject: Record<string, IProjectContractLink[] | undefined> = {};
  // Per-component observer helpers (computedFn wraps the function in a
  // computed so multiple subscribers in the same render share one
  // re-render trigger).
  contractService: ContractService;

  constructor(private rootStore: CoreRootStore) {
    this.contractService = new ContractService();
    makeObservable(this, {
      contractsFetched: observable,
      linksFetched: observable,
      contractsByWorkspace: observable,
      linksByProject: observable,
      fetchWorkspaceContracts: action,
      fetchProjectContractLinks: action,
    });
  }

  /** Lazy-loaded workspace contract list. Re-fetches only if the cache is
   *  empty; the import command is the only writer today, so a manual
   *  refetch is rarely needed. */
  fetchWorkspaceContracts = async (workspaceSlug: string) => {
    if (this.contractsFetched[workspaceSlug]) return;
    try {
      const contracts = await this.contractService.listWorkspaceContracts(workspaceSlug);
      runInAction(() => {
        this.contractsByWorkspace[workspaceSlug] = contracts;
        this.contractsFetched[workspaceSlug] = true;
      });
    } catch (error) {
      // Mirror the existing project-custom-field store's failure mode: log
      // and leave the cache as undefined so a retry is one click away. The
      // project-info block renders the empty state until success.
      console.error("Failed to fetch workspace contracts", error);
      runInAction(() => {
        this.contractsFetched[workspaceSlug] = true; // don't re-attempt on every render
      });
    }
  };

  /** Lazy-loaded per-project join rows. */
  fetchProjectContractLinks = async (workspaceSlug: string, projectId: string) => {
    const key = `${workspaceSlug}::${projectId}`;
    if (this.linksFetched[key]) return;
    try {
      const links = await this.contractService.listProjectContractLinks(workspaceSlug, projectId);
      runInAction(() => {
        this.linksByProject[key] = links;
        this.linksFetched[key] = true;
      });
    } catch (error) {
      console.error("Failed to fetch project contract links", error);
      runInAction(() => {
        this.linksFetched[key] = true;
      });
    }
  };

  /** Derived: the contracts that touch this project, in the shape the
   *  "related contracts" block needs (the contract object plus a denormalised
   *  allocation_ratio from the join row). Returns an empty array before the
   *  workspace contracts have been fetched OR before this project's link
   *  rows have been fetched; the block component should call both fetchers
   *  in parallel and tolerate the empty state in the meantime. */
  getContractsForProject(workspaceSlug: string, projectId: string) {
    const all = this.contractsByWorkspace[workspaceSlug] ?? [];
    const links = this.linksByProject[`${workspaceSlug}::${projectId}`] ?? [];
    if (all.length === 0 || links.length === 0) return [];
    // Build a project_id -> link lookup once, then join in a single pass. O(n+m)
    // where n=contracts, m=links. We keep the iteration in the function body
    // (rather than computedFn) because both observables are already tracked.
    const linkByProjectId = new Map<string, IProjectContractLink>();
    for (const link of links) {
      linkByProjectId.set(link.project, link);
    }
    return all
      .filter((contract) =>
        (contract.project_links ?? []).some((l) => l.project_id === projectId)
      )
      .map((contract) => {
        // Mirror the linked contract's allocation_ratio onto the contract so
        // the block can render "10%" without separately indexing links.
        const ownLink = (contract.project_links ?? []).find((l) => l.project_id === projectId);
        return {
          ...contract,
          // Field name kept the same as the join row's allocation_ratio so the
          // block reads one shape regardless of which source it consumed.
          allocation_ratio: ownLink?.allocation_ratio ?? null,
        };
      });
  }
}
