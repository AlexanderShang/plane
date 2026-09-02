/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): header for
 * /<workspace>/settings/contracts/. Mirrors BillingWorkspaceSettingsHeader's
 * shape so the SettingsContentWrapper + sidebar continue to work the same
 * way.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { SettingsPageHeader } from "@/components/settings/page-header";

export const ContractsWorkspaceSettingsHeader = observer(function ContractsWorkspaceSettingsHeader() {
  const { t } = useTranslation();
  return (
    <>
      <PageHead title={t("contract.list.title")} />
      <SettingsPageHeader
        title={t("contract.list.title")}
        description={t("contract.list.description")}
      />
    </>
  );
});
