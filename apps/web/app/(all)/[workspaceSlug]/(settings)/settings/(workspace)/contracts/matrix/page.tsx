/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): the contract ×
 * project matrix route, Phase D. Renders ContractMatrixRoot under the
 * standard workspace settings header.
 */

import { observer } from "mobx-react";
// components
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { ContractMatrixRoot } from "@/components/contract/contract-matrix-root";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { ContractsWorkspaceSettingsHeader } from "../header";

function ContractMatrixPage() {
  // i18n
  const { t } = useTranslation();
  // store hooks
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();

  const canPerformReadActions = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  if (workspaceUserInfo && !canPerformReadActions) {
    return <NotAuthorizedView section="settings" className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<ContractsWorkspaceSettingsHeader />}>
      <PageHead title={t("contract.matrix.title")} />
      <div className="size-full">
        <ContractMatrixRoot />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(ContractMatrixPage);
