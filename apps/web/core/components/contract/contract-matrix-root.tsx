/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): workspace-level
 * contract × project matrix, Phase D. Renders one row per contract and one
 * column per project; each cell shows the contract-project link's
 * `allocation_ratio` (or a blank when the pair is unlinked). Read-only --
 * Phase B.3 already covers link management via the contract detail page.
 *
 * The matrix is computed entirely client-side from
 * ContractStore.getContractsForWorkspace (which already returns contract
 * records with their embedded project_links arrays) joined against
 * ProjectStore.getProjectById for the column header names. The choice to
 * build a matrix this way (rather than a new backend endpoint) follows the
 * 'additive not refactor' discipline recorded in
 * docs/internal-contract-project-relationship-implementation-2026-09.md
 * -- no new URL pattern, no new serializer, no DB migration.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/ui";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/ui";
// hooks
import { useContract } from "@/hooks/store/use-contract";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";

type Props = {
  /** Optional override of the project list to use as the matrix columns.
   *  Defaults to the ProjectStore's full project list for the workspace.
   *  If the store hasn't loaded yet, the matrix renders the contracts
   *  alone and the user sees an empty row. */
  projectIdFilter?: (projectId: string) => boolean;
};

export const ContractMatrixRoot = observer(function ContractMatrixRoot(props: Props) {
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const { fetchWorkspaceContracts, contractsByWorkspace, contractsFetched } = useContract();
  // Use the actual IProjectStore fields: projectMap is the Record<id, TProject>
  // already loaded by fetchProjects(); workspaceProjectIds is the computed list
  // of ids; fetchStatus is the lifecycle indicator. The PR #25 review caught
  // a previous version that used 'workspaceProjects(...)' as a function and
  // 'workspaceProjectsFetched' as a Record -- neither exists on the store.
  const { projectMap, workspaceProjectIds, fetchProjects, fetchStatus } = useProject();
  const { allowPermissions } = useUserPermissions();
  const canView = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    if (!workspaceSlug) return;
    void fetchWorkspaceContracts(workspaceSlug.toString());
    void fetchProjects(workspaceSlug.toString());
  }, [workspaceSlug, fetchWorkspaceContracts, fetchProjects]);

  // The column set is the workspace's project list, optionally narrowed by
  // the projectIdFilter prop. The row set is the workspace's contract list,
  // narrowed by the customer / status filter inputs.
  const { contracts, projects, customers, statuses } = useMemo(() => {
    const allContracts = workspaceSlug
      ? contractsByWorkspace[workspaceSlug.toString()] ?? []
      : [];
    // Resolve workspaceProjectIds into full TProject records via projectMap.
    // A missing project (deleted between fetches) is silently dropped, which
    // matches the list page's own rendering tolerance.
    const allProjects = workspaceSlug
      ? (workspaceProjectIds ?? [])
          .map((id) => projectMap[id])
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
      : [];
    const filteredProjects = props.projectIdFilter
      ? allProjects.filter((p) => props.projectIdFilter!(p.id))
      : allProjects;
    const filteredContracts = allContracts.filter((c) => {
      if (customerFilter && (c.customer ?? "") !== customerFilter) return false;
      if (statusFilter && (c.status ?? "") !== statusFilter) return false;
      return true;
    });
    const customerSet = new Set<string>();
    const statusSet = new Set<string>();
    for (const c of allContracts) {
      if (c.customer) customerSet.add(c.customer);
      if (c.status) statusSet.add(c.status);
    }
    return {
      contracts: filteredContracts,
      projects: filteredProjects,
      customers: Array.from(customerSet).sort(),
      statuses: Array.from(statusSet).sort(),
    };
  }, [workspaceSlug, contractsByWorkspace, workspaceProjectIds, projectMap, customerFilter, statusFilter, props.projectIdFilter]);

  // Build an O(N + M) lookup table from the contract list. Each contract's
  // project_links array is already embedded in the API response, so the
  // join is purely client-side and avoids any N+1 on the network.
  const linkByContractProject = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const c of contracts) {
      for (const link of c.project_links ?? []) {
        // allocation_ratio is a string like "0.1000" (decimal) or null; keep
        // the raw value here and format it on render. We key by contract id
        // + project id pair so the render loop is O(1) per cell.
        map.set(`${c.id}::${link.project_id}`, link.allocation_ratio);
      }
    }
    return map;
  }, [contracts]);

  if (!workspaceSlug) {
    return null;
  }
  const ws = workspaceSlug.toString();
  const contractsReady = contractsFetched[ws];
  // IProjectStore exposes fetchStatus as a single observable rather than a
  // per-workspace Record; 'complete' is the terminal value set by
  // fetchProjects() (project.store.ts:348), so this is the correct gate.
  const projectsReady = fetchStatus === "complete";

  if (!contractsReady || !projectsReady) {
    return (
      <div className="p-6">
        <Loader>
          <Loader.Item height="32px" />
          <Loader.Item height="200px" />
        </Loader>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="p-6">
        <p className="text-body-sm-regular text-tertiary">{t("contract.matrix.no_access")}</p>
      </div>
    );
  }

  // Empty-state paths
  if (contracts.length === 0) {
    return (
      <div className="p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <h2 className="text-h3-medium text-primary">{t("contract.matrix.title")}</h2>
          <div className="rounded-sm border border-subtle p-8 text-center text-body-sm-regular text-tertiary">
            {t("contract.matrix.no_contracts")}
          </div>
        </div>
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <h2 className="text-h3-medium text-primary">{t("contract.matrix.title")}</h2>
          <div className="rounded-sm border border-subtle p-8 text-center text-body-sm-regular text-tertiary">
            {t("contract.matrix.no_projects")}
          </div>
        </div>
      </div>
    );
  }

  // The CSS grid tracks the projects dynamically. We cap the row height via
  // min-content and rely on horizontal scroll for workspaces with many
  // projects. The first row is the project name header (sticky on the
  // horizontal axis) and the first column is the contract label.
  const cellMinWidth = "minmax(60px, 1fr)";
  const gridTemplate = `60px ${projects.map(() => cellMinWidth).join(" ")}`;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <h2 className="text-h3-medium text-primary">{t("contract.matrix.title")}</h2>
          <p className="text-body-xs-regular text-secondary">{t("contract.matrix.description")}</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-body-xs-medium text-tertiary">
            <span>{t("contract.matrix.filter.customer")}</span>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="rounded-sm border border-subtle bg-surface-1 px-2 py-1 text-body-sm-regular text-primary"
            >
              <option value="">{t("contract.matrix.filter.all")}</option>
              {customers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-body-xs-medium text-tertiary">
            <span>{t("contract.matrix.filter.status")}</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-sm border border-subtle bg-surface-1 px-2 py-1 text-body-sm-regular text-primary"
            >
              <option value="">{t("contract.matrix.filter.all")}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <span className="text-body-xs-regular text-tertiary">
            {t("contract.matrix.summary", {
              contracts: contracts.length,
              projects: projects.length,
            })}
          </span>
        </div>

        <div
          className="overflow-auto rounded-sm border border-subtle"
          style={{ display: "grid", gridTemplateColumns: gridTemplate, minWidth: "100%" }}
        >
          {/* Header row: project names */}
          <div className="sticky top-0 z-10 border-b border-subtle bg-surface-1 px-2 py-2 text-body-xs-medium text-tertiary">
            {t("contract.matrix.column.contract")}
          </div>
          {projects.map((p) => (
            <div
              key={p.id}
              className="sticky top-0 z-10 border-b border-l border-subtle bg-surface-1 px-2 py-2 text-body-xs-medium text-secondary"
              title={p.name}
            >
              <span className="block max-w-[120px] truncate">{p.name}</span>
              <span className="block text-body-xs-regular text-tertiary">{p.identifier}</span>
            </div>
          ))}

          {/* Body rows: one per contract */}
          {contracts.map((c) => (
            <ContractMatrixRow
              key={c.id}
              contract={c}
              projects={projects}
              linkByContractProject={linkByContractProject}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

/**
 * One row of the matrix: a fixed-width first cell with the contract
 * identifier, then one cell per project showing the allocation_ratio (or
 * empty when no link exists). The allocation_ratio is rendered as a
 * percentage; if the contract link has it stored as the raw decimal
 * "0.1000" the cell multiplies by 100. If the source has a pre-formatted
 * percent string the cell passes it through as-is.
 */
const ContractMatrixRow = observer(function ContractMatrixRow(props: {
  contract: import("@plane/types").IContract;
  projects: import("@plane/types").TProject[];
  linkByContractProject: Map<string, string | null>;
}) {
  const { contract, projects, linkByContractProject } = props;
  return (
    <>
      <div className="border-b border-r border-subtle bg-surface-1 px-2 py-2 text-body-xs-medium text-primary">
        <span className="block max-w-[120px] truncate" title={contract.contract_no}>
          {contract.contract_no}
        </span>
        {contract.contract_name && (
          <span className="block max-w-[120px] truncate text-body-xs-regular text-tertiary">
            {contract.contract_name}
          </span>
        )}
      </div>
      {projects.map((p) => {
        const ratio = linkByContractProject.get(`${contract.id}::${p.id}`);
        const hasLink = ratio !== undefined;
        return (
          <div
            key={p.id}
            className={
              "border-b border-l border-subtle px-2 py-2 text-body-xs-regular " +
              (hasLink
                ? "bg-success-subtle text-success-primary"
                : "text-tertiary")
            }
            title={hasLink ? `${(ratio as string | null) ?? "—"}` : ""}
          >
            {hasLink ? formatRatio(ratio) : ""}
          </div>
        );
      })}
    </>
  );
});

/**
 * Format an allocation_ratio coming back from the backend for display.
 * - null / undefined / empty: em-dash
 * - anything Number(raw) rejects (NaN, Infinity, non-numeric strings
 *   like "1.0%"): em-dash (defense in depth; backend currently only
 *   stores decimal strings like "0.1000", so this branch is theoretical)
 * - a finite number: scaled to percent with one decimal, trimming the
 *   trailing .0 (so 0.10 -> "10 %", 1.00 -> "100 %")
 */
function formatRatio(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const pct = n * 100;
  // One decimal place, but trim trailing .0 (so 100.0 shows as "100 %").
  const fixed = pct.toFixed(1).replace(/\.0$/, "");
  return `${fixed} %`;
}
