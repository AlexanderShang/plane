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
import { ContractService, TContractPayload } from "@/services/project";
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
      createContract: action,
      updateContract: action,
      deleteContract: action,
      linkContract: action,
      unlinkContract: action,
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

  /** Phase B.2a mutating actions. Each invalidates the relevant cache(s)
   *  after the API call so subsequent reads do not return stale rows. The
   *  detail page calls fetchWorkspaceContracts() again after a write to
   *  pick up the server's response (e.g. updated_at, normalised strings).
   *  Errors are thrown -- the calling form is responsible for catching
   *  and showing the toast. */
  createContract = async (workspaceSlug: string, payload: TContractPayload): Promise<IContract> => {
    const contract = await this.contractService.createContract(workspaceSlug, payload);
    runInAction(() => {
      const list = this.contractsByWorkspace[workspaceSlug];
      if (list) {
        this.contractsByWorkspace[workspaceSlug] = [contract, ...list];
      }
    });
    return contract;
  };

  updateContract = async (
    workspaceSlug: string,
    contractId: string,
    payload: TContractPayload
  ): Promise<IContract> => {
    const contract = await this.contractService.updateContract(workspaceSlug, contractId, payload);
    runInAction(() => {
      const list = this.contractsByWorkspace[workspaceSlug];
      if (list) {
        this.contractsByWorkspace[workspaceSlug] = list.map((c) => (c.id === contract.id ? contract : c));
      }
    });
    return contract;
  };

  deleteContract = async (workspaceSlug: string, contractId: string): Promise<void> => {
    await this.contractService.deleteContract(workspaceSlug, contractId);
    runInAction(() => {
      const list = this.contractsByWorkspace[workspaceSlug];
      if (list) {
        this.contractsByWorkspace[workspaceSlug] = list.filter((c) => c.id !== contractId);
      }
      // Invalidate every per-project links cache: a contract that
      // disappeared can no longer be in any project's list. The block
      // re-fetches on next mount.
      const nextLinksByProject: typeof this.linksByProject = {};
      for (const [key, links] of Object.entries(this.linksByProject)) {
        nextLinksByProject[key] = links.filter((l) => l.contract !== contractId);
      }
      this.linksByProject = nextLinksByProject;
    });
  };

  /** Phase B.3 actions. `linkContract` invalidates the per-project links
   *  cache for the project that just got a new row; `unlinkContract`
   *  optimistically removes the row from cache (the server already
   *  removed it, so a subsequent read would refetch and confirm). */
  linkContract = async (
    workspaceSlug: string,
    projectId: string,
    payload: { contract: string; allocation_ratio?: string }
  ): Promise<IProjectContractLink> => {
    const link = await this.contractService.linkContract(workspaceSlug, projectId, payload);
    runInAction(() => {
      const key = `${workspaceSlug}::${projectId}`;
      const existing = this.linksByProject[key] ?? [];
      // Replace by id if already present, else append. The backend's
      // UniqueConstraint(contract, project) prevents duplicates; the
      // optimistic check is only to keep the cache array-shaped.
      const next = existing.some((l) => l.id === link.id) ? existing : [...existing, link];
      this.linksByProject[key] = next;
    });
    return link;
  };

  unlinkContract = async (workspaceSlug: string, projectId: string, linkId: string): Promise<void> => {
    await this.contractService.unlinkContract(workspaceSlug, projectId, linkId);
    runInAction(() => {
      const key = `${workspaceSlug}::${projectId}`;
      const existing = this.linksByProject[key];
      if (existing) {
        this.linksByProject[key] = existing.filter((l) => l.id !== linkId);
      }
    });
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
    // Index the project's link rows by contract id once (m=links entries) so
    // the per-contract lookup is O(1) instead of O(m). The previous version
    // built a Map and never read it (F1), and then ran a `.find()` over the
    // embedded contract.project_links for every contract, making the join
    // O(n*m). This implementation is O(n+m).
    const linkByContractId = new Map<string, IProjectContractLink>();
    for (const link of links) {
      linkByContractId.set(link.contract, link);
    }
    const result: (IContract & { allocation_ratio: string | null })[] = [];
    for (const contract of all) {
      // The link is per-project, so a contract can show up here only if one of
      // its embedded project_links points at projectId (the endpoint already
      // pre-filtered by project, but the workspace contract list does not).
      const ownLinkFromServer = (contract.project_links ?? []).find((l) => l.project_id === projectId);
      if (!ownLinkFromServer) continue;
      const ownLinkFromPerProject = linkByContractId.get(contract.id);
      result.push({
        ...contract,
        // Prefer the per-project endpoint's allocation_ratio when present, so
        // the block shows the row-scoped share even if the workspace endpoint
        // has a different value (e.g. a re-import updated the link but not the
        // cache yet). Fall back to the embedded link when the per-project
        // endpoint is empty or stale.
        allocation_ratio: ownLinkFromPerProject?.allocation_ratio ?? ownLinkFromServer.allocation_ratio ?? null,
      });
    }
    return result;
  }
}
