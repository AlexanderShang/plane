/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): workspace-level
 * Contract list, Phase B.2b. Renders the contracts returned by
 * ContractStore.getContractsForWorkspace, with a New Contract button that
 * opens ContractFormModal in create mode. Clicking a row navigates to the
 * detail page.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IContract } from "@plane/types";
import { Loader } from "@plane/ui";
// components
import { ContractFormModal } from "./contract-form-modal";
import { isPlaceholderContractNo } from "./contract-placeholder";
// hooks
import { useContract } from "@/hooks/store/use-contract";
import { useUserPermissions } from "@/hooks/store/user";

export const ContractListRoot = observer(function ContractListRoot() {
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const { fetchWorkspaceContracts, contractsByWorkspace, contractsFetched } = useContract();
  const { allowPermissions } = useUserPermissions();
  const canEdit = allowPermissions([1], 20);

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    if (!workspaceSlug) return;
    void fetchWorkspaceContracts(workspaceSlug.toString());
  }, [workspaceSlug, fetchWorkspaceContracts]);

  if (!workspaceSlug) {
    return null;
  }
  const ws = workspaceSlug.toString();
  const contracts = contractsByWorkspace[ws];
  const loaded = contractsFetched[ws];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h3-medium text-primary">{t("contract.list.title")}</h2>
            <p className="text-body-xs-regular text-secondary">{t("contract.list.description")}</p>
          </div>
          {canEdit && (
            <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("contract.list.new_button")}
            </Button>
          )}
        </div>

        {!loaded || !contracts ? (
          <Loader>
            <Loader.Item height="40px" />
            <Loader.Item height="40px" />
            <Loader.Item height="40px" />
          </Loader>
        ) : contracts.length === 0 ? (
          <div className="rounded-sm border border-subtle p-8 text-center text-body-sm-regular text-tertiary">
            {t("contract.list.empty")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-sm border border-subtle">
            <table className="w-full">
              <thead className="border-b border-subtle bg-surface-1">
                <tr>
                  <th className="px-4 py-2 text-left text-body-xs-medium text-tertiary">
                    {t("contract.list.columns.contract_no")}
                  </th>
                  <th className="px-4 py-2 text-left text-body-xs-medium text-tertiary">
                    {t("contract.list.columns.contract_name")}
                  </th>
                  <th className="px-4 py-2 text-left text-body-xs-medium text-tertiary">
                    {t("contract.list.columns.customer")}
                  </th>
                  <th className="px-4 py-2 text-left text-body-xs-medium text-tertiary">
                    {t("contract.list.columns.sign_date")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c: IContract) => (
                  <tr key={c.id} className="border-b border-subtle last:border-b-0 hover:bg-surface-1">
                    <td className="px-4 py-2 text-body-sm-medium text-primary">
                      <Link href={`/${ws}/settings/contracts/${c.id}/`} className="hover:underline">
                        {c.contract_no}
                      </Link>
                      {isPlaceholderContractNo(c.contract_no) && (
                        <span className="ml-2 inline-block">
                          <Badge variant="warning" size="sm">
                            {t("contract.placeholder_badge")}
                          </Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-body-sm-regular text-secondary">{c.contract_name || "—"}</td>
                    <td className="px-4 py-2 text-body-sm-regular text-secondary">{c.customer || "—"}</td>
                    <td className="px-4 py-2 text-body-sm-regular text-secondary">{c.sign_date || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ContractFormModal
        isOpen={isCreateOpen}
        mode="create"
        onClose={() => setIsCreateOpen(false)}
        onSaved={() => {
          // The form already closed itself; the cache is updated by the
          // store action. No additional invalidation needed.
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("contract.list.created_toast"),
          });
        }}
      />
    </div>
  );
});
