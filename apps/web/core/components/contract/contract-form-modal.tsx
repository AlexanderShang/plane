/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): the create / edit
 * modal for Contract, Phase B.2b. Two modes:
 *   - mode="create": empty form, contract_no required and unique per workspace
 *   - mode="edit": pre-filled with the existing contract; contract_no
 *     field is hidden (the backend's ContractUpdateSerializer omits it too,
 *     defense in depth)
 *
 * Both modes submit via ContractStore.createContract / .updateContract and
 * surface backend errors (CONFLICT_CONTRACT_NO and similar) via the
 * standard TOAST_TYPE.ERROR toast.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Input } from "@makeplane/propel/components/input";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useContract } from "@/hooks/store/use-contract";
import { useUserPermissions } from "@/hooks/store/user";
// types
import type { IContract } from "@plane/types";
import type { TContractPayload } from "@/services/project/contract.service";

type Mode = "create" | "edit";

type Props = {
  isOpen: boolean;
  mode: Mode;
  /** Required when mode="edit"; ignored when mode="create". */
  contract?: IContract;
  onClose: () => void;
  /** Called after a successful save; the form modal closes itself
   *  before this fires so the parent can decide whether to navigate. */
  onSaved?: (contract: IContract) => void;
};

type FormState = {
  contract_no: string;
  contract_name: string;
  contract_type: string;
  customer: string;
  sign_date: string;
  start_date: string;
  end_date: string;
  total_amount: string;
  tax_rate: string;
  status: string;
};

const EMPTY: FormState = {
  contract_no: "",
  contract_name: "",
  contract_type: "",
  customer: "",
  sign_date: "",
  start_date: "",
  end_date: "",
  total_amount: "",
  tax_rate: "",
  status: "",
};

function fromContract(c: IContract): FormState {
  return {
    contract_no: c.contract_no,
    contract_name: c.contract_name,
    contract_type: c.contract_type,
    customer: c.customer,
    sign_date: c.sign_date ?? "",
    start_date: c.start_date ?? "",
    end_date: c.end_date ?? "",
    total_amount: c.total_amount ?? "",
    tax_rate: c.tax_rate ?? "",
    status: c.status,
  };
}

export const ContractFormModal = observer(function ContractFormModal(props: Props) {
  const { isOpen, mode, contract, onClose, onSaved } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const { createContract, updateContract } = useContract();
  const { allowPermissions } = useUserPermissions();
  const canEdit = allowPermissions([1], 20 /* PROJECT level, ignored for ADMIN check */);
  // The view layer already gates write on ADMIN at the API; the form
  // additionally hides the Save button if the user can't write, so we
  // don't show a form that 403s on submit.

  const [form, setForm] = useState<FormState>(EMPTY);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (mode === "edit" && contract) {
      setForm(fromContract(contract));
    } else if (mode === "create") {
      setForm(EMPTY);
    }
  }, [isOpen, mode, contract]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!workspaceSlug) return;
    if (mode === "create" && !form.contract_no.trim()) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("contract.form.errors.contract_no_required"),
      });
      return;
    }
    setIsSubmitting(true);
    const payload: TContractPayload = {
      contract_no: form.contract_no.trim(),
      contract_name: form.contract_name.trim(),
      contract_type: form.contract_type.trim(),
      customer: form.customer.trim(),
      sign_date: form.sign_date || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      total_amount: form.total_amount.trim() || null,
      tax_rate: form.tax_rate.trim() || null,
      status: form.status.trim(),
    };
    try {
      const saved =
        mode === "create"
          ? await createContract(workspaceSlug.toString(), payload)
          : await updateContract(workspaceSlug.toString(), contract!.id, payload);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t(mode === "create" ? "contract.form.create_success" : "contract.form.update_success"),
      });
      onClose();
      onSaved?.(saved);
    } catch (error: unknown) {
      // Backend returns { error: "CONFLICT_CONTRACT_NO", detail: "..." } on
      // duplicate. Match the code so the toast is informative; fall back
      // to a generic message for other failures.
      const errCode = (error as { error?: string } | undefined)?.error;
      const title =
        errCode === "CONFLICT_CONTRACT_NO"
          ? t("contract.form.errors.contract_no_conflict")
          : t("contract.form.errors.save_failed");
      setToast({ type: TOAST_TYPE.ERROR, title });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <div className="p-5">
        <h3 className="text-h4-medium text-primary">
          {t(mode === "create" ? "contract.form.create_title" : "contract.form.edit_title")}
        </h3>
        <p className="mt-1 text-body-xs-regular text-secondary">
          {t("contract.form.description")}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {mode === "create" && (
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-body-xs-medium text-tertiary">
                {t("contract.form.fields.contract_no")} *
              </label>
              <Input
                value={form.contract_no}
                onChange={(e) => update("contract_no", e.target.value)}
                placeholder="HT2026-001"
                disabled={!canEdit || isSubmitting}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.contract_name")}
            </label>
            <Input
              value={form.contract_name}
              onChange={(e) => update("contract_name", e.target.value)}
              disabled={!canEdit || isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.contract_type")}
            </label>
            <Input
              value={form.contract_type}
              onChange={(e) => update("contract_type", e.target.value)}
              disabled={!canEdit || isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.customer")}
            </label>
            <Input
              value={form.customer}
              onChange={(e) => update("customer", e.target.value)}
              disabled={!canEdit || isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.sign_date")}
            </label>
            <Input
              type="date"
              value={form.sign_date}
              onChange={(e) => update("sign_date", e.target.value)}
              disabled={!canEdit || isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.start_date")}
            </label>
            <Input
              type="date"
              value={form.start_date}
              onChange={(e) => update("start_date", e.target.value)}
              disabled={!canEdit || isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.end_date")}
            </label>
            <Input
              type="date"
              value={form.end_date}
              onChange={(e) => update("end_date", e.target.value)}
              disabled={!canEdit || isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.total_amount")}
            </label>
            <Input
              value={form.total_amount}
              onChange={(e) => update("total_amount", e.target.value)}
              placeholder="0.0000"
              disabled={!canEdit || isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.tax_rate")}
            </label>
            <Input
              value={form.tax_rate}
              onChange={(e) => update("tax_rate", e.target.value)}
              placeholder="0.0000"
              disabled={!canEdit || isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className="text-body-xs-medium text-tertiary">
              {t("contract.form.fields.status")}
            </label>
            <Input
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
              disabled={!canEdit || isSubmitting}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t-[0.5px] border-subtle px-5 py-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          {t("contract.form.cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={!canEdit || isSubmitting}
        >
          {t(mode === "create" ? "contract.form.submit_create" : "contract.form.submit_update")}
        </Button>
      </div>
    </ModalCore>
  );
});
