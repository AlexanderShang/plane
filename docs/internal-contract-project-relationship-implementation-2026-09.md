# Contract-Project 多对多关系重构 — Phase A + B 实施记录

> **状态**: Phase A + B 全部已合并到 `AlexanderShang/plane:preview` (latest HEAD `058e605e8`)。
>
> 这份文档覆盖从 Phase A (commit `260ccae81`,仅 model + import) 到 Phase B 全部 (B.1 read API, B.1b project-info 区块, B.2a write API, B.2b settings UI, B.3 link management) 的实施过程。
>
> 配套文档:
> - 设计文档: [docs/internal-contract-project-relationship.md](internal-contract-project-relationship.md)
> - 进度文档: [docs/internal-project-custom-fields.md](internal-project-custom-fields.md)
> - 测试指南: [docs/contract-project-test-guide.md](contract-project-test-guide.md) (独立测试环境的 step-by-step)
>
> 这份文件是给"换 Agent 也能接着干"用的实施记录,记录**决策、真实数据发现、踩坑、未决问题**。设计文档解释"为什么这么设计",这份文档解释"具体怎么做的、踩了什么坑"。

## 一句话回顾

Phase A 把项目自定义字段从 23 个 ProjectCustomField 拆成"17 ProjectCustomField + 5 Contract/ContractProject 原生列 + 1 整体删除",让合同 ↔ 项目 的真实多对多关系能在 DB 层表达,而不是靠拼字符串去绕。

## 实施清单(对应 commit `260ccae81`)

| 文件 | 改动类型 | 关键内容 |
|---|---|---|
| `apps/api/plane/db/models/contract.py` | 新建 | `Contract` (workspace 级主数据, UniqueConstraint(workspace, contract_no)) + `ContractProject` (Contract<->Project M:N 关联, UniqueConstraint(contract, project))。继承 `BaseModel` 而非 `WorkspaceBaseModel` 是有意的——Contract 不挂任何单个 Project。 |
| `apps/api/plane/db/models/__init__.py` | 注册 | `from .contract import Contract, ContractProject`。**这是上次修过的 sibling 坑**:定义了但没导出。已通过 AST 校验。 |
| `apps/api/plane/db/default_data/project_custom_fields.py` | 23 → 17 | 删 A 列("合同号&项目号" 整体删除,不是拆分)。删 F/G/H/I/J(搬去 Contract/ContractProject)。L 列("项目序号") `is_unique_key=True` 从 A 列挪过来。 |
| `apps/api/plane/utils/historical_project_import.py` | 解析层 | `parse_row` / `validate_headers` 加可选 `header_row` 参数:传它时按表头名查(让 DEFAULT_PROJECT_CUSTOM_FIELDS 不必镜像 xlsx 列号);不传时退化为"按列号位置" + stderr 一次性警告(老测试走这条路径)。 |
| `apps/api/plane/db/management/commands/import_historical_project_data.py` | 改造 | 不读 A 列(legacy composite 字段整体忽略);Contract / ContractProject 入库走 `get_or_create`(DB UniqueConstraint 兜底);`_coerce_contract_cell` 专门处理 Excel datetime/int 误解析(67% 数据命中)。 |
| `apps/api/plane/db/migrations/0126_internal_contract_project.py` | 新建 | Contract + ContractProject schema。两个。` + reverse-direction `project` index。 |
| `apps/api/plane/db/migrations/0127_internal_contract_project_is_unique_key_reset.py` | 新建 | RunPython 数据迁移:把已 seed 老 Project 的"合同号&项目号" `is_unique_key=True` 重置为 False(因为 `seed_default_custom_fields` 只 seed 不改旧字段,Phase A seed 后会有两个 `is_unique_key=True` 字段并存,违反不变量)。Reverse 是 noop——回滚会重新引入同样的不变量违反。 |
| `apps/api/plane/tests/unit/management/test_import_historical_project_data.py` | 测试 | `XLSX_HEADERS` 改为显式 23 列 A-W 布局(1 retired + 17 project + 5 contract);`_row()` 按 xlsx 列号填;税率/合同占比断言改查 Contract.tax_rate / ContractProject.allocation_ratio。 |
| `apps/api/plane/app/serializers/project_custom_field.py` | 注释更新 | Line 129 注释从 "合同号&项目号" 改成 "项目序号",反映 Phase A 的唯一键迁移。 |
| `docs/internal-contract-project-relationship.md` | 同步 | "业务规则固化"小节加入;23 → 17 字段归属表重写;两个"未决问题"小节删除(已解答);Phase A 实施清单更新。 |
| `docs/internal-project-custom-fields.md` | 同步 | 23 → 17 引用全部更新;Phase A 状态从"进行中"改"完成";Contract/ContractProject 数据模型小节加入;Phase A 兼容性警告加入。 |

## 决策记录(为什么这么改而不是那样改)

### 1. 合同号从字符串拼成 `{合同号}{项目号}` 不是 `{合同号}-{项目号}` 也不是 `{合同号}&{项目号}`

`{合同号}{项目号}` 无分隔符是**唯一合法格式**,由系统在运行时拼接 (`Contract.contract_no + Project.项目序号`)。这条业务规则固化在 `docs/internal-contract-project-relationship.md` 的"业务规则固化"小节,作为 Phase A 之后**所有** xlsx 导入模板、UI 展示、运维脚本的唯一合法形式。

为什么不让表格保留 A 列让用户维护?——70%/78% 一致率(不同 xlsx 版本),占位符"暂无/待签约"、datetime 误解析(`5763-5` → `datetime(5763, 5, 1)`)、反向拼接(`W19012&5762` vs `5762&W19012`)等多种脏数据形态都从 A 列进入系统。让 A 列只展示,不进数据模型——避免未来每个新的导入任务都要重复解决同一组解析问题。

### 2. F 列 datetime 反解析放在 `_coerce_contract_cell` 而不是通用 `coerce_text`

`coerce_text` 是公开 helper,改它会影响其他测试和调用者。把 datetime/int 特判收敛在 `_coerce_contract_cell` 里,只对合同号这**一列**生效,影响面最小化。

触发逻辑:
- `datetime` 且时分秒为 0 → `f"{year}-{month}"` (Excel 解析的"YYYY-M"格式)
- `datetime` 但带时分 → `str(datetime)` (真日期值,保持原 ISO)
- `int` → `str(int)` (Excel 把"5824-8" 解析成 int 5824,丢后缀;无法恢复,只能接受丢部分)

**没把 int 路径标 warning**——这是已知数据丢失,4/189 行命中,不值得给用户加噪声。

### 3. `parse_row` 双模式而不是"只支持 header_row 模式"

旧测试 `test_historical_project_import.py` 用 4 项 `FIELD_SPECS` 直接传 `parse_row`,不传 `header_row`。如果强制要求 `header_row`,要改一堆纯函数测试。给 `parse_row` 一个 "fallback to positional" 的可选行为 + stderr 一次性警告,既保留了向后兼容,也提醒调用方"你正在用 legacy 行为,Phase A 后不安全"。

### 5. seed_default_custom_fields **不删/改旧字段**

`seed_default_custom_fields` 只创建缺失字段(`existing_names` 比对),不删除已存在字段,不重置 `is_unique_key`。这意味着:
- 老 Project 上"合同号&项目号" `is_unique_key=True` 不会自动消失
- Phase A seed 新字段"项目序号" `is_unique_key=True` 后,老 Project 会**临时**有两个 `is_unique_key=True` 字段

修复通过 `0127_internal_contract_project_is_unique_key_reset.py` (RunPython 数据迁移) 完成:重置老 flag,防御性确保新 flag 设置。**`migrate db 0125` 后必须 `migrate db 0127`**,否则生产环境会出现两个 unique 字段并存的 bug。

### 4. _get_or_create_contract 不用 advisory lock

ProjectCustomFieldValue 的唯一性走 advisory lock,因为它存在"每个 Project 一行"的表里,DB 表达不出跨行约束。**Contract 是真正的全局表**,UniqueConstraint 在 DB 层就够了,advisory lock 没必要。注释里写清楚这个差异,免得未来有人 copy-paste 时漏掉。

## 真实数据发现(踩到的坑)

| 发现 | 数据证据 | Phase A 的处理 |
|---|---|---|
| F 列 124/189 行被 Excel 自动解析成 datetime | `datetime(5763, 5, 1)` 来自字符串"5763-5" | `_coerce_contract_cell` 特判重建为 "5763-5" |
| F 列 4/189 行被 Excel 解析成 int(丢后缀) | Row 37: F=int(5725), 真实合同号应是 "5725-22" | 接受丢后缀,转成 str(int),加日志记录 |
| A 列"合同号&项目号" 拼接格式混乱 | 30% 数据不是 `{G}{L}` 干净拼接,包括反向、`&` 分隔、占位符 | A 列整体忽略为数据;脏数据靠 F+L 走 Contract/Project 路径清洗 |
| 多对多关系真实存在 | 148 个唯一合同号中 22 个出现 ≥2 次 | Contract(workspace 主数据) + ContractProject(关联表) 是唯一正解 |
| 占位符"暂无" / "待签约" | 各 7 次 | Contract.contract_no 接受任意字符串,UI 层处理"未签约"状态(Phase B 范围) |
| B 列 B 是 int 而非 datetime | 5725 → "5725", 丢后缀 | 同 datetime 路径,转字符串接受 |

## 未决问题(留给未来 session)

按 think skill 的 Phase Independence 原则,Phase A 已经是**独立可合并**状态(系统能完整记录 Contract 和 Project 关系)。以下留给 Phase B/C/D:

| 编号 | 描述 | 何时处理 |
|---|---|---|
| PB-1 | "暂无" / "待签约" 占位 Contract 的 UI 区分 | **已完成**(Phase B.2c: `contract-placeholder.ts` 的 `isPlaceholderContractNo`,应用在列表页/详情页/项目详情页"关联合同"区块三处) |
| PB-2 | Contract 列表页 + 创建/编辑 UI | **已完成**(Phase B.2b `contract-list-root.tsx`/`contract-form-modal.tsx`,PR #17;Phase B.2c 补上详情页缺的"下方关联项目列表",`contract-detail-root.tsx` 读 `contract.project_links` 并联查 `ProjectStore.getProjectById`) |
| PC-1 | ContractProject 增删改独立管理页 | Phase C |
| PD-1 | 合同 × 项目矩阵视图 | Phase D(暂缓,等真实使用反馈) |
| PE-1 | 关系图 + 直接/间接关联区分 | Phase E(暂缓) |
| PP-1 | `seed_default_project_custom_fields` 何时在真实数据库跑(老项目补种) | 跟 owner 确认 |
| PP-2 | 员工邮件模板 `apps/api/templates/emails/project_data/custom_field_data.html` 还是占位符 | 后期 |

## 怎么测试

跟 [internal-project-custom-fields.md](internal-project-custom-fields.md#怎么测试) 同款流程:

```bash
docker compose -f docker-compose-local.yml up -d

# 单测(纯逻辑 + 数据库集成,39 个)
docker compose -f docker-compose-local.yml exec api pytest \
    plane/tests/unit/management/ \
    plane/tests/unit/utils/test_historical_project_import.py -v

# 历史数据导入,先 dry-run
docker compose -f docker-compose-local.yml exec api python manage.py import_historical_project_data \
    /code/<xlsx路径> --workspace <slug> --created-by <email> --dry-run
```

## 回滚

按 commit 顺序回滚即可:
```bash
git revert c868d9cfb   # merge commit
git revert 260ccae81   # 实施 commit
```

数据迁移 0127 reverse 是 noop,需要手动跑清理 SQL(把"项目序号" `is_unique_key=True` 重置为 False,把"合同号&项目号" `is_unique_key=True` 设回——前提是回滚后还想保持 Phase A 之前的不变量)。

更安全的回滚:**先回滚 0127 的 RunPython 副作用(手动 SQL),再 revert commit**。直接 revert 不会回滚已执行的迁移,只回滚代码。

---

# Phase B 实施记录 (B.1 + B.2a + B.2b + B.3)

> 本段覆盖从 Phase A 完成后到 Phase B 全部合并(latest `058e605e8`)的过程。Phase B 跨度大、commit 多,按时间顺序记录。

## B.1 — read-only API + project-info 区块 (PR #13, commits `7b5154a9c` + `fe88596a8`)

### 范围

最小可读路径:
- **后端 B.1a**: Contract/ContractProject 的 3 个 GET endpoint,无写操作
- **前端 B.1b**: 项目详情页底部加 "Related contracts" 区块,客户端 join contract.project_links

### 实施清单

| Commit | 文件 | 改动 |
|---|---|---|
| `7b5154a9c` | `apps/api/plane/app/serializers/contract.py` (新建) | ContractSerializer + ContractProjectSerializer |
| `7b5154a9c` | `apps/api/plane/app/views/contract.py` (新建) | ContractViewSet + ContractProjectViewSet + ContractAccessPermission (GUEST-reject 模式) |
| `7b5154a9c` | `apps/api/plane/app/urls/contract.py` (新建) | URL 路由 |
| `7b5154a9c` | `apps/api/plane/tests/unit/models/test_contract.py` (新建) | 3 个 model test (UniqueConstraint) |
| `7b5154a9c` | 3 个 `__init__.py` | 注册符号 |
| `fe88596a8` | `apps/web/core/services/project/contract.service.ts` (新建) | 2 个 list 方法 |
| `fe88596a8` | `apps/web/core/store/contract.store.ts` (新建) | MobX store + 2 个 fetch + 1 个 derived (getContractsForProject) |
| `fe88596a8` | `apps/web/core/hooks/store/use-contract.ts` (新建) | context hook |
| `fe88596a8` | `apps/web/core/components/contract/related-contracts-block.tsx` (新建) | project-info 区块 |
| `fe88596a8` | `apps/web/core/components/project-info/project-info-root.tsx` | 挂载区块 |
| `fe88596a8` | `apps/web/core/store/root.store.ts` | 注册 contractStore |
| `fe88596a8` | `apps/web/core/services/project/index.ts` + `packages/types/src/index.ts` | 导出 |
| `fe88596a8` | `packages/i18n/src/locales/{en,zh-CN}/project-custom-field.json` | 加 related_contracts 临时 key |

### 踩坑 / 决策

- **N+1 修复 (PR #14 F2)**: 第一次 list endpoint 触发了 200+ queries (每个 contract 一次 `project_links.all()`)。PR #14 修 `get_queryset().prefetch_related("project_links")` 解决。
- **Decouple 临时复用 project-custom-field i18n**: B.1b 只有 2 个 key,临时塞进 project-custom-field.json。B.2b 时拆出独立 `contract.json`。
- **ABAB 反 pattern (PR #14 F3)**: 第一次写 `ContractAccessPermission` 用 `view.kwargs.get("slug")` — 跟同 pattern 的 `ProjectCustomFieldAccessPermission` 用 `view.workspace_slug` 不一致。**`\b` word boundary 修复** 后续 PR #16 工具能捕获。
- **PR #16 process tool**: commit `3550054ee` 加了 `tools/check_viewset_decorators.py` + AGENTS.md rule 4。**这是 F1 教训的产物**:如果当时有这工具,PR #15 不会需要 review fix。
- **没跑独立测试环境**: PR #13 merge 前**没有真机跑过 pytest**,只在 worktree 做了 AST / grep 静态检查。回想起来这是 process gap,不是单 commit 的 bug。

### Commit 时间线(B.1 范围)

```
7b5154a9c  feat(api): Phase B.1a (Contract read API)
b8b1071d4  Merge PR #14 (F1-F6 review fixes)
d0c8025f5  fix(contract): F1-F6 (N+1, view.workspace_slug, IProjectContractLink Omit, etc.)
b749482b4  Merge PR #13
27153f6f7  docs: add Docker test guide for Phase B.1
fe88596a8  feat(web): Phase B.1b (related-contracts block)
```

注: PR #13 实际合并了 2 个 commit (B.1a + B.1b + docs),不是分别的 PR。PR #14/15 的 merge commit 列在 B.1 timeline 是因为它们发生在 B.1b 之后(为后续 B.2a 修复 F1-F5);具体 B.2a 自己的 commit 在 B.2a 段。

## B.2a — 后端 write API (PR #15, commit `ce5945fcd` + review fix `16dd8d4ac`)

### 范围

3 个写 endpoint (POST/PATCH/DELETE),ContractAccessPermission 双重 ADMIN 守卫,IntegrityError 翻译,validate_contract_no 规范化。

### 踩坑 / 决策

- **🔥 CRITICAL F1 (PR #15 review)**: `@allow_permission([ROLE.ADMIN])` 默认 `level="PROJECT"` 查 `kwargs["project_id"]`,但 contract URL 没 project_id → 所有 write 调用都 403(包括 admin)。Review 报告发现,PR #14 follow-up 修。**这是我自己在写 PR #15 时引入的,本地没跑测试所以没发现**。`tools/check_viewset_decorators.py` (PR #16) 正是为这类 bug 加的。
- **F2 (PR #14 follow-up)**: `_workspace_id_from_slug` 用 `self` instance attribute 缓存 → 跨请求 footgun。删除缓存,改无条件查(单 indexed query,廉价)。
- **F3 (PR #14 follow-up)**: `ContractAccessPermission` 改用 `view.workspace_slug`(跟 ProjectCustomFieldAccessPermission 一致)。
- **F4 (PR #15 follow-up)**: `IsAuthenticated` 底部 import + `# noqa: E402` 是不必要的循环 import 防御。顶部 import 即可。
- **`contract_no` 不可变**: `ContractUpdateSerializer.Meta.fields` 显式不包含 `contract_no` (虽然 `id` / `created_at` 等在 instance 上是 read-only 字段,DRF 会自动 skip,但 `contract_no` 不在 fields 里就完全不被接受)。防御 depth 1: 客户端不能发;depth 2: 服务端拒绝。
- **IntegrityError 翻译**: DB UniqueConstraint 触发时,Django 默认返 500。view 在 `transaction.atomic()` 块里捕获并返 400 with `error='CONFLICT_CONTRACT_NO'`。前端 toast 能精确匹配错误码。
- **test_concurrent_runs / 0127 reverse 之类**: B.2a 不需要,Contract.get_or_create + DB UniqueConstraint 已经够。

### Commit 时间线

```
ce5945fcd  feat(api): B.2a Contract write endpoints
16dd8d4ac  fix(contract): F1-F5 (level="WORKSPACE", workspace_id cache, etc.)
4eee820f9  Merge PR #15
058e605e8  Merge PR #20 (B.2b allowPermissions typo fix)  ← 我刚做的
394633809  fix(web): correct allowPermissions args in Contract B.2b components
```

## B.2b — 前端 settings UI (PR #17, commit `75d81d951` + review fix PR #20 `394633809`)

### 范围

- 后端 service: 加 `createContract` / `updateContract` / `deleteContract` (B.2a) + `linkContract` / `unlinkContract` (B.3) 方法 + `TContractPayload` type
- 后端 store: 5 个 mutating action + cache invalidation (delete 跨所有 projects 的 link cache)
- 前端组件: `ContractFormModal` (create/edit 共用 modal) + `ContractListRoot` + `ContractDetailRoot` + `RelatedContractsBlock` 加 Link
- 路由: `(workspace)/settings/contracts/page.tsx` + `[contractId]/page.tsx` + `header.tsx`
- i18n: 拆出独立 `contract.json` (en + zh-CN),`related_contracts` keys 仍留在 `project-custom-field.json` (因为属于 project-info page)

### 踩坑 / 决策

- **🔥 HIGH B.2b typo (PR #20 fix)**: `allowPermissions([1], 20)` — 同样是 typo,跟前端的 `@allow_permission([ROLE.ADMIN])` (B.2a) 是同一类 bug。
  - `[1]` 不是 EUserPermissions 合法值 (5/15/20),`canEdit` 永远 false
  - `20` 应该是 string `"WORKSPACE"` 而不是数字
  - 影响: "New Contract" 按钮永远不显示,Save 按钮永远 disabled,Edit/Delete 按钮不出现
  - TypeScript 没报错因为 `ETempUserRole = TUserPermissions | EUserWorkspaceRoles | EUserProjectRoles` 是数字 enum 联合,接受 `[1]` (数字)
  - **发现渠道**: 这次 /check 报告 (commit 后),PR #19 (web compile fix) 没发现 — 那个只修了 syntax error `}` 多余
  - **修复**: PR #20 (`394633809`), 3 个文件都改 `allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE)`
- **i18n 拆文件**: B.1b 临时复用 project-custom-field.json,B.2b 拆出独立 contract.json。**这次拆分让 future contract 改动不会污染 project-custom-field file**。
- **CONFLICT_CONTRACT_NO 处理**: modal 捕获 backend 返回的 `error` 字段,精确显示 "合同号已存在" 错误(而不是泛化 "保存失败")。
- **delete 跨项目 cache invalidation**: `deleteContract` action 必须从 `linksByProject` 字典的**所有** key 里移除,不只是当前 project — 否则 project-info 页面还会显示已删除的 contract。
- **Form modal 复用**: create 和 edit 共用 `ContractFormModal`,edit 模式隐藏 contract_no 字段(后端拒绝 + 客户端 UI 不显示,defense in depth)。

### Commit 时间线

```
75d81d951  feat(web): B.2b Contract settings UI
4c9b641ce  Merge PR #17
81fd7eb64  feat(web): complete Phase B contract UI (linked projects + placeholder badge)  ← PR #18 (别人)
21493c3fc  Merge PR #18
7b7b2fa5d  fix: restore web compile + make Celery cascade tests deterministic  ← PR #19 (别人)
00cdfaa11  Merge PR #19
394633809  fix(web): correct allowPermissions args in B.2b components  ← 我
058e605e8  Merge PR #20
```

## B.3 — ContractProject link management (PR #18, commit `81fd7eb64`,别人做的)

### 范围

虽然 Phase A 模型已经有 `ContractProject` join 表,但 B.1 + B.2a 的 endpoint 不暴露它的写入。B.3 (PR #18) 加了:
- 端点: `POST /workspaces/<slug>/projects/<uuid>/contracts/` 和 `DELETE /workspaces/<slug>/projects/<uuid>/contracts/<pk>/`
- 前端: `ContractDetailRoot` 加 "Related projects" section (展示 link 的 project 名)
- 占位符: `contract-placeholder.ts` 集中处理 "暂无" / "待签约",在 3 个 contract_no 渲染处 (list / detail / related-contracts block) 统一

### 踩坑 / 决策(我没参与,但读到 commit message 后记录)

- **related projects 用 ProjectStore.getProjectById 取 project 名**: 避免在 contract 详情页重新 fetch projects 列表。
- **PB-1 placeholder badge**: Phase A 方案里列的 "暂无" / "待签约" 占位符识别,推迟到 B.3 实施。统一工具函数,3 处渲染保持一致。

### Commit 时间线

(已合并在 PR #18,commit `81fd7eb64`)

## 整个 Phase B 的 review lessons(写给未来的我 / Agent)

按时间倒序:

1. **PR #17 → PR #20 (`allowPermissions([1], 20)`)**: 同一类 bug 在 backend (`@allow_permission`) 和 frontend (`allowPermissions`) 各出现一次,**都因为"复制粘贴" 旧代码 + 没真正理解参数语义**。修了 backend 后,frontend 没自查。预防: 跨前后端共享测试 fixture,或者 review 时跨 file 搜 "同样的 magic number"。
2. **PR #13 F1 (decorator default level)**: TypeScript / Python 都没强类型保护这类 API 调用,reviewer 必须读 allow_permission 的实现才知道 default level 是 "PROJECT"。**`tools/check_viewset_decorators.py` (PR #16) 是这类 bug 的最终防线**。类似工具的形态: 静态分析调用方的 view/URL kwargs,跟装饰器要求对比。
3. **process gap**: PR #13 (B.1) 和 PR #15 (B.2a) 都在本地**没跑过 pytest** merge 到 origin/preview。结果 PR #13 包含一个 syntax error (`}` 多余,PR #19 才修),PR #15 包含 CRITICAL F1 bug (PR #16 follow-up 才修)。按 AGENTS.md "本机只做开发,测试在独立测试环境" 的约定是 OK 的,但**应在 commit 前至少跑一次** `python tools/check_viewset_decorators.py` 之类的快速检查。
4. **i18n 文件拆分**: B.1 临时复用 project-custom-field.json 是 pragmatism,B.2b 拆出独立 contract.json 是**正确的边界划分**。未来 i18n 改动不应该跨过这个边界。
5. **Plan 粒度**: Phase B 分成 B.1 / B.2a / B.2b / B.3 4 个独立 PR 是正确的 — 每个 PR 自己可合并 (Phase Independence),即便后面的 PR 拖延 / 失败,B.1 (read API) 仍然给前端提供基础。

## 真实数据发现(Phase A → B 都没变,记录保留)

来自 Phase A 段(原文): F 列 124/189 行 Excel 误解析 datetime,A 列 70% 拼接混乱, 多对多真实存在 (148 contracts, 22 个合同号重复)。

## 整个 Phase A + B 的工作流纪律(写给未来)

按 AGENTS.md "Git workflow: commit, push, merge" 规则 1-11:
1. 永远 feature branch
2. re-read status + HEAD before stage
3. 显式 `git add` 文件
4. 完整 commit message (what + why)
5. push feature branch,不是 preview
6. **显式 `--repo AlexanderShang/plane` + 验证 baseRepositoryOwner (规则 11)** — 之前误推到 upstream 的教训
7. check PR state before merge
8. `--merge --delete-branch=false` (保留 feature branch,继续叠 PR)
9. **每步独立 go-ahead** — 之前自动 merge low-risk fix 是 implicit assumption
10. 不用 `--no-verify` / force-push
11. (新增) cross-repo safety — 同规则 6+7

实际节奏(本次会话): 21 个 PR (#1-#21) + 1 个 test guide + 1 个 process tool,跨度 5h50m (PR #11 09-02 01:20 UTC → PR #21 09-02 07:10 UTC),commit timestamp 聚成 3 个 time cluster (01:20/02:21/05:41),不是 3 个独立 session 的证据。

## 未决问题(原文 Phase A 段保留)

- PP-1: `seed_default_project_custom_fields` 何时在真实数据库跑
- PP-2: 员工邮件模板 placeholder 后期

## Phase B.2 / B.3 状态

- ✅ B.1a (read API): PR #13
- ✅ B.1b (project-info 区块): PR #13
- ✅ B.2a (write API): PR #15
- ✅ B.2b (settings UI): PR #17
- ✅ B.2b allowPermissions typo fix: PR #20
- ✅ B.3 (link management): PR #18
- ✅ test guide: PR #13 commit `27153f6f7`
- ✅ process tool (check_viewset_decorators): PR #16
- ✅ web compile fix + Celery test: PR #19
- ⏸️ i18n F7 advisory: en + zh-CN only(项目现状)
- ⏸️ Phase D (矩阵视图): 方案文档标"暂缓"
- ⏸️ Phase E (关系图): 方案文档标"暂缓"

按 "今天基本做完 Phase B" 的目标 —— **Phase B 全部完成**。后续 Phase D / E 是真实使用反馈驱动的可选工作,不在本 session 范围。

## 边界纪律(写给未来 Agent,不要违反)

按"是否需要重构 Plane 原代码" Evaluation 结论(本 session): **保持增补,不重构**。具体边界如下,踩到任一即为违规:

### 不能改的(Plane 原 model / 行为)

- ❌ `apps/api/plane/db/models/{project_custom_field,project,workspace,base,audit_model}.py`  — 我们的 contract 端用 `BaseModel` 继承而非 `WorkspaceBaseModel`,因为 `WorkspaceBaseModel` 携带的 project FK 语义跟 contract 不匹配。**不要为了"看起来一致" 改 `WorkspaceBaseModel`**。
- ❌ `apps/api/plane/app/views/project_custom_field.py`  — 我们的 `ContractAccessPermission` 跟 `ProjectCustomFieldAccessPermission` 用了同样的 GUEST-reject 模式,但**不要为了统一而抽取公共基类**。两个 permission 类的角色判断和 kwargs 访问 pattern 不同(`view.workspace_slug` vs `view.workspace_slug + view.project_id`),抽公共会引入新耦合。
- ❌ `apps/api/plane/settings/helper.py`  — 现有 `getWorkspaceActivePath` / `pathnameToAccessKey` 是 Plane 原 helper,不要为了 contract 加新 helper 而改它。

### 不能跨边界改的(Plane 原 endpoint / pattern)

- ❌ `apps/api/plane/app/urls/*.py` 里除 `contract.py` 之外的 route  — 不要为了 contract 改其他 viewset 的 URL prefix
- ❌ `apps/api/plane/app/views/base.py`  — 不要为 contract viewset 改 `BaseViewSet` 通用逻辑
- ❌ `apps/web/core/components/settings/{workspace,project}/*`  — 不要改 settings layout / sidebar / header 已有 pattern 来适配 contract。如果需要新菜单项,在现有 settings 导航注册而不是改 layout

### 可以改的(我们自己的代码)

- ✅ `apps/api/plane/db/models/contract.py`  — 完全自有
- ✅ `apps/api/plane/db/migrations/01XX_*.py`(contract 相关的)
- ✅ `apps/api/plane/app/serializers/contract.py`  — 完全自有
- ✅ `apps/api/plane/app/views/contract.py`  — 完全自有
- ✅ `apps/api/plane/app/urls/contract.py`  — 完全自有
- ✅ `apps/api/plane/tests/unit/{models,views}/test_contract*.py`  — 完全自有
- ✅ `apps/web/core/components/contract/` 目录(新)— 完全自有
- ✅ `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/contracts/` 路由 — 完全自有
- ✅ `apps/web/core/services/project/contract.service.ts`  — 完全自有
- ✅ `apps/web/core/store/contract.store.ts`  — 完全自有
- ✅ `apps/web/core/hooks/store/use-contract.ts`  — 完全自有
- ✅ `packages/i18n/src/locales/{en,zh-CN}/contract.json`  — 完全自有(独立 i18n file,不污染 project-custom-field.json)
- ✅ `docs/internal-{contract,project,custom-fields}-*.md`  — 完全自有
- ✅ `tools/check_viewset_decorators.py`  — 完全自有(进程工具)

### 跨边界的"显式 import"规则

- ✅ **contract 端可以 import Plane 原 utilities**(如 `useUserPermissions`, `EUserPermissions` 等)— 这是显式依赖,不是改 Plane
- ❌ **contract 端不应被 Plane 原 import** — 如果 `views/project_custom_field.py` 需要引用 contract,需要重新考虑:大概率是错的边界

### i18n 边界

- ✅ 继续"独立 `contract.json` file",不污染 Plane 原 locale files
- ❌ 不要在 `project-custom-field.json` 里再加 contract 相关的 key(PR #21 已经把 related_contracts 留下,这是历史遗留;后续 B.2b 添加的 contract.* 都在 contract.json)
- ❌ 不要修改 Plane 原 locale files(en.json, zh-CN.json, 等)以添加 contract 翻译

### 为什么是增补不是重构(对未来的解释)

- **fork 兼容性**:Plane 是 fork(起源 makeplane/plane)。大量重构让 fork 与 upstream 漂移,未来 `git merge makeplane:preview` 会爆。增补让冲突局限在 `contract.py` / `contract/` 目录,合并成本低。
- **PR 独立性**:Phase A/B 的 4 个 PR 各自独立可合并 (Phase Independence)。重构会引入跨文件耦合,让独立 PR 模型崩塌。
- **零接触 Plane 原 model**:Phase A 的 Contract / ContractProject 是新 model,不动 ProjectCustomField / Project / Workspace。重构这些 model 不会改进 contract 端,只会让 fork diverge。
- **已建立的 docs 标 Internal**:所有 contract 相关文件顶部都有 "Internal addition (not part of upstream makeplane/plane)" 注释。跨边界时这个注释要保留。

### 触发 review 的条件

如果未来发现某个**改 1 行 contract 端**需要**改 ≥3 处 Plane 原文件**,立即停下来问"是不是越界了"。这通常是"增补"开始失败、需要重新评估的信号。