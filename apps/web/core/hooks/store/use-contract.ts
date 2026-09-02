/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): thin context hook
 * for ContractStore, mirroring the pattern of useProjectCustomField
 * (apps/web/core/hooks/store/use-project-custom-field.ts). The store instance
 * lives on CoreRootStore; this hook just reads it off the React context.
 */

import { useContext } from "react";
// mobx store
import { StoreContext } from "@/lib/store-context";
// types
import type { IContractStore } from "@/store/contract.store";

export const useContract = (): IContractStore => {
  const context = useContext(StoreContext);
  if (context === undefined) throw new Error("useContract must be used within StoreProvider");
  return context.contract;
};
