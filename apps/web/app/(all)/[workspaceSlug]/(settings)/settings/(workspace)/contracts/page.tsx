/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): workspace-level
 * Contract list page, Phase B.2b. Mirrors BillingSettingsPage's shape so
 * the surrounding SettingsContentWrapper + sidebar layout continues to work.
 */

import { observer } from "mobx-react";
// components
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { ContractListRoot } from "@/components/contract/contract-list-root";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { ContractsWorkspaceSettingsHeader } from "./header";

function ContractsSettingsPage() {
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
      <div className="size-full">
        <ContractListRoot />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(ContractsSettingsPage);
