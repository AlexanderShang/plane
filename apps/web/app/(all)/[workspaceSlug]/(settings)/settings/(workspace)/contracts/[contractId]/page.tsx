/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): single Contract
 * detail page, Phase B.2b. Reuses ContractsWorkspaceSettingsHeader (the
 * page-level chrome is the same on list and detail).
 */

import { observer } from "mobx-react";
// components
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { ContractDetailRoot } from "@/components/contract/contract-detail-root";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";
// local imports
import { ContractsWorkspaceSettingsHeader } from "../header";

function ContractDetailPage({ params }: Route.ComponentProps) {
  // route params
  const { contractId } = params;
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
        <ContractDetailRoot contractId={contractId} />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(ContractDetailPage);
