/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): single-contract
 * detail page, Phase B.2b. Renders the contract's financial + relationship
 * metadata and exposes Edit / Delete actions. The Edit action reuses
 * ContractFormModal in mode="edit"; Delete calls the store's
 * deleteContract and routes back to the list.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { observer } from "mobx-react";
import { useParams, useRouter } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IContract } from "@plane/types";
import { Loader } from "@plane/ui";
// components
import { ContractFormModal } from "./contract-form-modal";
// hooks
import { useContract } from "@/hooks/store/use-contract";
import { useUserPermissions } from "@/hooks/store/user";

type Props = {
  contractId: string;
};

function findContract(contracts: IContract[] | undefined, contractId: string): IContract | undefined {
  return contracts?.find((c) => c.id === contractId);
}

export const ContractDetailRoot = observer(function ContractDetailRoot(props: Props) {
  const { contractId } = props;
  const { workspaceSlug } = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { contractsByWorkspace, contractsFetched, fetchWorkspaceContracts, deleteContract } =
    useContract();
  const { allowPermissions } = useUserPermissions();
  const canEdit = allowPermissions([1], 20);

  const [isEditOpen, setIsEditOpen] = useState(false);

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
  const contract = findContract(contracts, contractId);

  if (!loaded) {
    return (
      <div className="p-6">
        <Loader>
          <Loader.Item height="60px" />
          <Loader.Item height="40px" />
          <Loader.Item height="40px" />
        </Loader>
      </div>
    );
  }
  if (!contract) {
    return (
      <div className="p-6">
        <div className="rounded-sm border border-subtle p-8 text-center text-body-sm-regular text-tertiary">
          {t("contract.detail.not_found")}
          <div className="mt-4">
            <Link href={`/${ws}/settings/contracts/`} className="text-body-sm-medium text-primary hover:underline">
              {t("contract.detail.back_to_list")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleDelete = async () => {
    if (typeof window !== "undefined" && !window.confirm(t("contract.detail.delete_confirm"))) {
      return;
    }
    try {
      await deleteContract(ws, contractId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("contract.detail.delete_success"),
      });
      router.push(`/${ws}/settings/contracts/`);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("contract.detail.delete_failed"),
      });
    }
  };

  // The label/row helpers are local to keep the file self-contained -- this
  // page has its own grid layout (key-value, two-column) that does not
  // match either the project-info block's or the list page's table.
  const rows: Array<[string, string | null]> = [
    [t("contract.detail.fields.contract_no"), contract.contract_no],
    [t("contract.detail.fields.contract_name"), contract.contract_name || null],
    [t("contract.detail.fields.contract_type"), contract.contract_type || null],
    [t("contract.detail.fields.customer"), contract.customer || null],
    [t("contract.detail.fields.sign_date"), contract.sign_date || null],
    [t("contract.detail.fields.start_date"), contract.start_date || null],
    [t("contract.detail.fields.end_date"), contract.end_date || null],
    [t("contract.detail.fields.total_amount"), contract.total_amount ? `${contract.total_amount} 万元` : null],
    [t("contract.detail.fields.tax_rate"), contract.tax_rate],
    [t("contract.detail.fields.status"), contract.status || null],
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href={`/${ws}/settings/contracts/`} className="text-body-xs-medium text-secondary hover:underline">
              ← {t("contract.detail.back_to_list")}
            </Link>
            <h2 className="mt-1 text-h3-medium text-primary">{contract.contract_no}</h2>
            {contract.contract_name && (
              <p className="text-body-sm-regular text-secondary">{contract.contract_name}</p>
            )}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIsEditOpen(true)}>
                {t("contract.detail.edit_button")}
              </Button>
              <Button variant="error-primary" onClick={handleDelete}>
                {t("contract.detail.delete_button")}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-sm border border-subtle p-4 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1.5">
              <span className="text-body-xs-medium text-tertiary">{label}</span>
              <span className="text-body-sm-regular text-primary">{value ?? "—"}</span>
            </div>
          ))}
        </div>
      </div>

      <ContractFormModal
        isOpen={isEditOpen}
        mode="edit"
        contract={contract}
        onClose={() => setIsEditOpen(false)}
        onSaved={() => {
          setIsEditOpen(false);
        }}
      />
    </div>
  );
});
