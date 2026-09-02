/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): the project-info
 * "related contracts" block, Phase B.1b's contribution. It reads the
 * workspace-level contract list from ContractStore, joins client-side on
 * project_links[*].project_id, and renders the contracts that touch the
 * current project.
 *
 * Read-only in this phase. The next link target for each row is a no-op
 * (Phase B.2 lands a contract detail page; the URL is left undefined here
 * so the B.1b block ships without a broken link).
 */

import { useEffect } from "react";
import Link from "next/link";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/ui";
// components
// hooks
import { useContract } from "@/hooks/store/use-contract";

// Group the heading text behind a single key so future copy edits land in
// one place rather than three (this file plus the parallel English and
// zh-CN locale files).
const HEADING_KEY = "project_custom_field.settings.project_info_page.related_contracts.heading";
const EMPTY_KEY = "project_custom_field.settings.project_info_page.related_contracts.empty";

type Props = {
  projectId: string;
};

export const RelatedContractsBlock = observer(function RelatedContractsBlock(props: Props) {
  const { projectId } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const contractStore = useContract();

  // Both fetches have to land before the block has anything to render, so
  // run them in parallel and rely on the store's per-key cache to dedupe on
  // re-render. We deliberately don't `await` either here: a slow response on
  // the per-project endpoint mustn't block the workspace-level data, and the
  // block's own `getContractsForProject` short-circuits on the empty case.
  useEffect(() => {
    if (!workspaceSlug) return;
    void contractStore.fetchWorkspaceContracts(workspaceSlug.toString());
    void contractStore.fetchProjectContractLinks(workspaceSlug.toString(), projectId);
  }, [workspaceSlug, projectId, contractStore]);

  if (!workspaceSlug) {
    return null;
  }

  const contracts = contractStore.getContractsForProject(
    workspaceSlug.toString(),
    projectId
  );

  // Distinguish three states so the UI can show a meaningful message in each:
  //   - still loading  -> spinner
  //   - loaded, empty  -> "no related contracts" hint
  //   - loaded, has rows -> render the table
  const workspaceLoaded = Boolean(
    contractStore.contractsFetched[workspaceSlug.toString()]
  );
  const projectLoaded = Boolean(
    contractStore.linksFetched[`${workspaceSlug.toString()}::${projectId}`]
  );

  return (
    <section>
      <h2 className="mb-3 text-body-sm-medium text-secondary">{t(HEADING_KEY)}</h2>
      <div className="rounded-sm border border-subtle p-4">
        {!workspaceLoaded || !projectLoaded ? (
          <Loader>
            <Loader.Item height="32px" />
            <Loader.Item height="32px" />
          </Loader>
        ) : contracts.length === 0 ? (
          <p className="text-body-xs-regular text-tertiary">{t(EMPTY_KEY)}</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {contracts.map((contract) => (
              <li key={contract.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-body-sm-medium text-primary">
                    <Link
                      href={`/${workspaceSlug}/settings/contracts/${contract.id}/`}
                      className="hover:underline"
                    >
                      {contract.contract_no}
                    </Link>
                    {contract.contract_name ? (
                      <span className="ml-2 text-body-sm-regular text-secondary">
                        {contract.contract_name}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-body-xs-regular text-tertiary">
                    {[
                      contract.customer || null,
                      contract.sign_date,
                      contract.total_amount
                        ? `${contract.total_amount} 万元`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {/* allocation_ratio comes from the joined link row, denormalised
                    onto the contract by ContractStore.getContractsForProject so
                    this component doesn't need a second map lookup. */}
                {contract.allocation_ratio ? (
                  <span className="shrink-0 text-body-xs-medium text-secondary">
                    {`${contract.allocation_ratio} %`}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
});
