/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Internal addition (not part of upstream makeplane/plane): PB-1 from
 * docs/internal-contract-project-relationship-implementation-2026-09.md
 * ("暂无" / "待签约" 占位 Contract 的 UI 区分). Phase A's import command
 * (apps/api/plane/db/management/commands/import_historical_project_data.py)
 * stores these two literal strings as real Contract.contract_no values when
 * the source spreadsheet's 合同号 cell was a placeholder rather than an
 * actual contract number -- the backend deliberately does not special-case
 * them (Contract.contract_no accepts any string), so the distinction is a
 * display-only concern, handled once here and shared by every component that
 * renders a contract_no (list, detail, related-contracts block).
 */

const PLACEHOLDER_CONTRACT_NOS = new Set(["暂无", "待签约"]);

export function isPlaceholderContractNo(contractNo: string | null | undefined): boolean {
  return !!contractNo && PLACEHOLDER_CONTRACT_NOS.has(contractNo.trim());
}
