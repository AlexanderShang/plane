# Contract / Project Phase B — WSL 2 + Docker Desktop 测试手册

> **Scope**: 本手册覆盖从"全新 WSL 2 Ubuntu + Docker Desktop"环境到"Phase B 全部端到端验证通过"的完整步骤。**目标读者是 Agent(不知道本项目上下文)或新接手的工程师** — 每一步都假设从零开始,不能依赖"之前的 session" 或 "本机已有 X"。
>
> 配套文档:
> - 设计方案: [docs/internal-contract-project-relationship.md](internal-contract-project-relationship.md)
> - 实施记录: [docs/internal-contract-project-relationship-implementation-2026-09.md](internal-contract-project-relationship-implementation-2026-09.md)
> - 通用测试指南(Docker-only): [docs/contract-project-test-guide.md](contract-project-test-guide.md)
> - 边界纪律: [docs/internal-contract-project-relationship-implementation-2026-09.md#边界纪律](internal-contract-project-relationship-implementation-2026-09.md) (不要碰 Plane 原文件)
>
> **目标**: 让一个全新环境,按本手册 step-by-step 执行后,能完整验证:
> - Phase B.1: Contract read API + project-info 区块
> - Phase B.2a: Contract write API (POST/PATCH/DELETE)
> - Phase B.2b: Contract settings UI (list/detail/form)
> - Phase B.3: ContractProject link management + placeholder badge
> - B.2a CRITICAL F1 修复有效(`@allow_permission` level)
> - B.2b frontend 修复有效(`allowPermissions` typo)
> - `tools/check_viewset_decorators.py` clean

## 0. 假设和前置

**假设环境**:
- WSL 2 已安装并运行(Windows 11 + WSL 2 Ubuntu 22.04 LTS)
- WSL 2 发行版: Ubuntu 22.04 LTS(20.04 / 24.04 也类似)
- Docker Desktop for Windows 已安装并启用 WSL 2 backend
- 联网(从 GitHub clone + pnpm install)
- 全新环境,本手册**不**假设本机已装 Python / Node / pnpm / git

**目标耗时**: 全程 ~40-90 分钟(取决于网络),大部分时间在 `pnpm install` 和 `docker compose up -d` 的等待。

## 1. 验证 WSL 2 + Docker Desktop

打开 PowerShell → 启动 WSL 2:

```bash
# PowerShell
wsl -l -v
# 预期: 列出已安装 distro,Ubuntu 应该是 "running" 或 "stopped"
```

启动 Ubuntu:

```bash
# PowerShell
wsl -d Ubuntu
# 预期: 进入 Ubuntu 的 shell,提示符是 user@hostname:~$
```

验证 WSL 2 + Docker Desktop:

```bash
# WSL 2 Ubuntu
lsb_release -a
# 预期: Description: Ubuntu 22.04... (Description 显示 22.04,不是 20.04)

docker --version
# 预期: Docker version 24.0.x 或更高,build 包含 "WSL 2" 或类似

docker context ls
# 预期: current context 是 "desktop-linux" (Docker Desktop 默认 WSL 2 integration)

docker run --rm hello-world
# 预期: "Hello from Docker!" 输出,容器下载并跑完后自动删除
```

如果 `docker --version` 报错或 `docker context ls` 没有 desktop-linux,**停下来先配 Docker Desktop**:
- 打开 Windows Docker Desktop → Settings → Resources → WSL Integration → 勾选 "Enable integration with my default WSL distro"
- 等待 Docker Desktop 重启
- 重新跑上面 3 个 docker 命令

## 2. 安装项目依赖

按顺序安装 git / Python / Node / pnpm。WSL 2 Ubuntu 用 `apt` + NodeSource + `npm install -g pnpm`。

```bash
# WSL 2 Ubuntu
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates
```

安装 Python 3.11 (Plane 后端 Django 需要 3.10+):

```bash
# WSL 2 Ubuntu
sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt install -y python3.11 python3.11-venv python3.11-dev
python3.11 --version
# 预期: Python 3.11.x
```

如果系统默认 python3 不是 3.11(可能是 3.10):

```bash
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
sudo update-alternatives --config python3  # 选 3.11 对应的 auto 编号
python3 --version  # 确认
```

安装 Node 20 LTS (Plane 前端需要 18+):

```bash
# WSL 2 Ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
# 预期: v20.x.x

npm --version
# 预期: 10.x.x 或 9.x.x
```

安装 pnpm 9.x (Plane monorepo 用 pnpm workspace):

```bash
# WSL 2 Ubuntu
npm install -g pnpm@9
pnpm --version
# 预期: 9.x.x
```

如果 `pnpm install -g pnpm@9` 在某些网络下失败,可能需要先配 npm registry 镜像:

```bash
npm config set registry https://registry.npmmirror.com
# (国内网络适用)然后重试 pnpm install
```

## 3. clone + checkout 仓库

```bash
# WSL 2 Ubuntu
# 推荐 clone 到 ~/projects/
mkdir -p ~/projects
cd ~/projects

# clone 用户 fork (不是 upstream makeplane/plane)
git clone https://github.com/AlexanderShang/plane.git
cd plane

# 切到 Phase B 完成后的 feature branch
git fetch origin
git checkout claude/repo-code-summary-22f444

# 验证
git log --oneline -5
# 预期最上面 commit 是 0dcdad29c(边界纪律 doc) 或 4ac2aa51b(同样的边界纪律)
# 实际应该有 边界纪律 → 实施记录 → B.2b typo fix → ... 23 个 PR
```

## 4. 跑 setup.sh 生成后端 .env

```bash
# WSL 2 Ubuntu
cd ~/projects/plane
./setup.sh
# 预期: 创建 apps/api/.env,显示 "Created apps/api/.env from .env.example"
```

如果 `setup.sh` 报权限错:

```bash
chmod +x setup.sh && ./setup.sh
```

确认 .env 生成:

```bash
ls -la apps/api/.env
# 预期: 文件存在,大小 > 0
head -5 apps/api/.env
# 预期: DATABASE_URL, REDIS_URL, SECRET_KEY 等
```

## 5. 启动 Docker Compose stack

Phase B 测试需要完整的 stack (Postgres + Redis + RabbitMQ + API + worker):

```bash
# WSL 2 Ubuntu
cd ~/projects/plane
docker compose -f docker-compose-local.yml up -d
```

预期: 
- 拉镜像(~3-10 分钟,取决于网络)
- 启动 5-6 个 container: postgres, redis, rabbitmq, api, worker, (可能还有 beat)
- `docker compose ps` 显示都是 "Up" 状态

等所有 container "Up"(不是 "Starting"):

```bash
# 持续观察(等 30 秒)
docker compose -f docker-compose-local.yml ps
# 预期: NAME 列是 "plane-postgres-1" 等,STATE 列 "Up",PORTS 列出 5432/6379/5672/8000 等
```

如果某个 container 持续 "Restarting" 或 "Exit",看 log:

```bash
docker compose -f docker-compose-local.yml logs --tail=50 api
# 找 ERROR / CRITICAL 行
```

**常见错误**:
- `database "plane" does not exist`: 跑一次 `docker compose -f docker-compose-local.yml exec postgres psql -U postgres -c "CREATE DATABASE plane;"`
- `port already in use`: `lsof -i :5432` 找占用进程,kill 它或改 docker-compose-local.yml 的 port mapping
- 镜像拉取超时: 重试,或配 Docker mirror

验证后端 health:

```bash
# WSL 2 Ubuntu
sleep 30  # 等待 Django migrate 跑完
docker compose -f docker-compose-local.yml logs --tail=20 api | grep -E "Starting|started|migrat"
# 预期: "Starting development server at http://0.0.0.0:8000/"

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/
# 预期: 200 (Django default page) 或 302/404 (Django app 没装 root)
# 不重要,只要不是 connection refused
```

## 6. 跑 migrate(确认 Phase A migrations 已应用)

```bash
# WSL 2 Ubuntu
docker compose -f docker-compose-local.yml exec api python manage.py showmigrations
# 预期: 显示 migrations 列表,包含:
#   [X] 0126_internal_contract_project
#   [X] 0127_internal_contract_project_is_unique_key_reset
# (X = 已应用)

docker compose -f docker-compose-local.yml exec api python manage.py migrate --plan
# 预期: 看到 0126 和 0127 在 plan 里(如果没 [X] 才需要 apply)
```

如果 `0126` 或 `0127` 标 `[ ]`(未应用):

```bash
docker compose -f docker-compose-local.yml exec api python manage.py migrate
# 预期: "Applying 0126_internal_contract_project... OK"
#         "Applying 0127_internal_contract_project_is_unique_key_reset... OK"
```

## 7. 跑后端 pytest

按 `docs/contract-project-test-guide.md` 第 1 节跑后端测试:

```bash
# WSL 2 Ubuntu
docker compose -f docker-compose-test.yml run --rm api-tests pytest \
    plane/tests/unit/management/ \
    plane/tests/unit/utils/test_historical_project_import.py \
    plane/tests/unit/models/test_contract.py \
    plane/tests/unit/views/test_contract_viewset.py \
    -v
```

预期:
- `test_import_historical_project_data.py`: 6 个 test 全部 pass
- `test_historical_project_import.py`: 多个 utility 测试 pass
- `test_contract.py`: 3 个 model 测试 pass
- `test_contract_viewset.py`: 5 个 view 测试 pass
- **总计: 14 个测试全 pass**

如果某些测试 fail:

```bash
# 单跑看详细
docker compose -f docker-compose-test.yml run --rm api-tests pytest \
    plane/tests/unit/views/test_contract_viewset.py::TestContractViewSetCreate::test_create_contract_happy_path -v
```

## 8. 创建测试 workspace + 用户

pytest 用 `create_user` 和 `_make_admin_workspace` fixture 自动建用户和 workspace。但 Phase B.2b / B.3 的浏览器 smoke 需要**手工创建**一个 workspace + admin user(用 Django shell)。

```bash
# WSL 2 Ubuntu
docker compose -f docker-compose-local.yml exec api python manage.py shell <<'EOF'
from plane.db.models import Workspace, WorkspaceMember
from uuid import uuid4
import secrets

slug = f"test-{uuid4().hex[:8]}"
ws = Workspace.objects.create(
    name="Test Workspace",
    slug=slug,
    id=uuid4(),
    owner_id="00000000-0000-0000-0000-000000000000"  # 占位
)
# 创建一个 admin user
from plane.db.models import User
admin_email = f"admin-{uuid4().hex[:6]}@test.local"
user = User.objects.create(
    email=admin_email,
    username=f"admin_{uuid4().hex[:6]}",
    is_active=True,
)
user.set_password("testpassword123")
user.save()
WorkspaceMember.objects.create(
    workspace=ws,
    member=user,
    role=20,  # ADMIN
    is_active=True,
)
# 创建一个 sample project 用于 project-info 测试
from plane.db.models import Project
project = Project.objects.create(
    name="Test Project",
    identifier=f"PRJ{uuid4().hex[:6]}",
    workspace=ws,
    created_by=user,
)
print("=" * 60)
print(f"WORKSPACE_SLUG={slug}")
print(f"ADMIN_EMAIL={admin_email}")
print(f"ADMIN_PASSWORD=testpassword123")
print(f"PROJECT_ID={project.id}")
print("=" * 60)
EOF
```

**输出形如**:
```
============================================================
WORKSPACE_SLUG=test-a1b2c3d4
ADMIN_EMAIL=admin-1a2b3c@test.local
ADMIN_PASSWORD=testpassword123
PROJECT_ID=12345678-1234-1234-1234-123456789012
============================================================
```

**记下这 4 个值** — 浏览器登录和后续 curl 测试需要。

## 9. 跑 import 命令(端到端 dry-run)

需要一份 `项目汇总表.xlsx` 或类似测试数据。**用户需要先准备**:
- 从原始测试数据(独立测试环境)下载 `项目汇总表.xlsx`
- 把它放到 `~/projects/plane/test-data.xlsx`

```bash
# WSL 2 Ubuntu
ls -la ~/projects/plane/test-data.xlsx
# 预期: 文件存在,大小 > 100KB
```

**复制到容器**:

```bash
# WSL 2 Ubuntu
docker cp ~/projects/plane/test-data.xlsx plane-api-1:/code/test-data.xlsx
# (container 名 plane-api-1 是 docker-compose-local.yml 启动的默认名,
#  如果不一样, 用 `docker compose -f docker-compose-local.yml ps` 查实际名)
```

**跑 dry-run**:

```bash
# WSL 2 Ubuntu
docker compose -f docker-compose-local.yml exec api \
    python manage.py import_historical_project_data \
        /code/test-data.xlsx \
        --workspace <WORKSPACE_SLUG 上面记下的> \
        --created-by <ADMIN_EMAIL 上面记下的> \
        --dry-run
```

预期:
- "Created N project(s)" — N 是 valid rows 数量,真实 `项目汇总表.xlsx` 应该 150-180
- "Skipped: X blank, Y missing unique key, Z duplicate, W error. V field-level warning(s)"
- V 应该是 6 (Phase A 调优后的 baseline)

**如果 fail**:

```bash
# 看详细报错
docker compose -f docker-compose-local.yml exec api \
    python manage.py import_historical_project_data \
        /code/test-data.xlsx --workspace <slug> --created-by <email> --dry-run 2>&1 | head -50
```

**验证数据库有数据**:

```bash
docker compose -f docker-compose-local.yml exec api python manage.py shell <<'EOF'
from plane.db.models import Contract, ContractProject
print(f"Contracts: {Contract.objects.count()}")
print(f"Links: {ContractProject.objects.count()}")
EOF
# 预期: Contracts > 100, Links > Contracts(多对多)
```

## 10. 验证 B.2a F1 修复 (Decorator level)

```bash
# WSL 2 Ubuntu
cd ~/projects/plane
python3 tools/check_viewset_decorators.py
```

预期:
- "skip BaseViewSet (no routes found in urls/*.py)"
- "check_viewset_decorators: clean (scanned 63 view files)."
- **exit 0**

**测试 fail path**(模拟 B.2a F1 状态):
如果想验证 script 能捕获 F1,临时把 `apps/api/plane/app/views/contract.py` 的 `@allow_permission([ROLE.ADMIN], level="WORKSPACE")` 改回 `@allow_permission([ROLE.ADMIN])`,再跑 script:
```bash
# 应该 3 个 mismatch:
# apps/api/plane/app/views/contract.py:103: ContractViewSet.create decorated with...
# apps/api/plane/app/views/contract.py:128: ContractViewSet.partial_update...
# apps/api/plane/app/views/contract.py:139: ContractViewSet.destroy...
# exit 1
# 改回 + 跑一次确认 exit 0
```

**Positive test**: 修回正确状态,跑 script 确认 exit 0。

## 11. 启动前端 dev server

**开第二个 WSL 2 terminal**(或用 tmux) — 一个跑 backend,一个跑 frontend:

```bash
# 第二个 WSL 2 Ubuntu 终端
cd ~/projects/plane
corepack enable
pnpm install
```

预期:
- `corepack enable` 启用 pnpm 自带 corepack
- `pnpm install` 装所有 monorepo 依赖,5-15 分钟

如果 `pnpm install` 报 workspace 协议错误:
```bash
cat package.json | grep -A 3 "packageManager"
# 应该显示: "packageManager": "pnpm@9.x.x"
```

如果版本不匹配:
```bash
corepack prepare pnpm@9.0.0 --activate
```

启动 web dev server:

```bash
# 第二个 WSL 2 Ubuntu 终端
cd ~/projects/plane/apps/web
pnpm dev
```

预期:
- 启动 Next.js dev server
- 输出 `ready - started server on 0.0.0.0:3000`
- 保持运行(不 Ctrl-C)

## 12. 浏览器 smoke test

打开 Windows 浏览器,访问 `http://localhost:3000` (或 WSL IP)。

### 12.1 登录

- Email: 第 8 步记下的 `ADMIN_EMAIL`
- Password: `testpassword123`

### 12.2 验证项目详情页 (B.1b - Related contracts 区块)

访问 `/<WORKSPACE_SLUG>/projects/<PROJECT_ID>/project-info/`

预期:
- 看到 17 个 custom field group (Phase A 后从 23 缩到 17)
- 底部看到 **"关联合同"** heading (zh-CN) 或 **"Related contracts"** (en)
- 如果 import 成功,应该看到关联的 contracts
- 如果没关联 contracts,空状态 "该项目暂未关联合同。"

### 12.3 验证 Contract Settings 页面 (B.2b)

访问 `/<WORKSPACE_SLUG>/settings/contracts/`

预期:
- 看到 "合同" (zh-CN) 或 "Contracts" (en) 标题
- 看到 "新建合同" 按钮(因为是 ADMIN)
- 列表显示从 import 来的 contracts

### 12.4 验证 Contract Detail 页面

在 contracts 列表点击一个 contract:

预期:
- 看到 contract 详情 (contract_no, contract_name, customer, sign_date, 等)
- 看到 "编辑" 和 "删除" 按钮(ADMIN)
- 看到 "关联项目" 区块 (B.3 实施)

### 12.5 验证 B.2b 修复 (New Contract 按钮可见)

Critical test: 之前 PR #17 引入的 `[1], 20` typo 导致 New Contract 按钮**永远不显示**。PR #20 修复后,**只有 ADMIN 看到按钮**,MEMBER / GUEST 看不到。

测试:
1. 当前用户是 ADMIN: 应该看到 "新建合同" 按钮
2. 在浏览器的 DevTools console:
   ```javascript
   // 验证 isAdmin
   JSON.parse(document.cookie).auth
   // 或 看 Network → /api/workspaces/.../contracts/ 返回 200
   ```
3. **不应该** 看到 `allowPermissions` 相关的 console error (如果有 React error boundary 触发)

### 12.6 创建新 Contract

点击 "新建合同" → 填入:
- contract_no: `TEST-2026-001`
- contract_name: `测试合同`
- customer: `测试客户`
- sign_date: `2026-09-02`
- total_amount: `100.0000`
- tax_rate: `0.1300`

点击 "创建"。

预期:
- Toast: "Contract created." (zh-CN) 或 "Contract created." (en)
- 自动跳到 contract detail 页面
- URL 包含新 contract 的 ID
- Detail 页面显示 "TEST-2026-001"

**Test duplicate** (验证 B.2a CONFLICT_CONTRACT_NO 错误处理):
- 再创建同一个 contract_no `TEST-2026-001`
- 应该: Toast: "该工作区已存在相同合同号的合同。" (zh-CN) 或 "A contract with this contract no. already exists in this workspace." (en)
- 不创建第二条

### 12.7 编辑 Contract

在 detail 页面点击 "编辑" → 改 contract_name → 保存。

预期:
- Toast: "Contract saved." (en)
- 详情页面显示新名字

### 12.8 删除 Contract

点击 "删除" → confirm →

预期:
- Toast: "Contract deleted." (en)
- 跳回 list 页面
- 列表中该 contract 不见

## 13. 端到端验证 (curl + browser 对账)

### 13.1 backend smoke (curl)

从 WSL 2 Ubuntu,用第 8 步的 admin 邮箱 + password 登录取得 session cookie:

```bash
# WSL 2 Ubuntu
# 登录取得 session token (简化版; 实际 DRF token auth)
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/sign-in/ \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"<ADMIN_EMAIL>\",\"password\":\"testpassword123\"}" \
    | python3 -c "import json, sys; print(json.load(sys.stdin).get('token', ''))")

# B.1: 列出 contracts
curl -s -H "Authorization: Bearer $TOKEN" \
    http://localhost:8000/api/workspaces/<WORKSPACE_SLUG>/contracts/ | jq '. | length'
# 预期: > 100 (Phase A import 的 contracts)

# B.1: 单个 contract
CONTRACT_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
    http://localhost:8000/api/workspaces/<WORKSPACE_SLUG>/contracts/ | jq -r '.[0].id')
curl -s -H "Authorization: Bearer $TOKEN" \
    "http://localhost:8000/api/workspaces/<WORKSPACE_SLUG>/contracts/$CONTRACT_ID/" | jq '.project_links | length'
# 预期: >= 0 (可能没有 link)

# B.2a: 创建一个新 contract via API
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"contract_no": "CURL-001", "contract_name": "curl test", "customer": "curl"}' \
    http://localhost:8000/api/workspaces/<WORKSPACE_SLUG>/contracts/
# 预期: 201,返回 {"id": "...", "contract_no": "CURL-001", ...}

# B.2a: duplicate contract_no
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"contract_no": "CURL-001", "customer": "dup"}' \
    http://localhost:8000/api/workspaces/<WORKSPACE_SLUG>/contracts/
# 预期: 400, {"error": "CONFLICT_CONTRACT_NO", "detail": "..."}

# B.2a: 清理
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
    "http://localhost:8000/api/workspaces/<WORKSPACE_SLUG>/contracts/$NEW_ID/"
# 预期: 204

# B.3: link 一个 project 到 contract
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"contract\":\"$CONTRACT_ID\"}" \
    "http://localhost:8000/api/workspaces/<WORKSPACE_SLUG>/projects/<PROJECT_ID>/contracts/"
# 预期: 201,返回 link 对象

# B.3: 删除 link
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
    "http://localhost:8000/api/workspaces/<WORKSPACE_SLUG>/projects/<PROJECT_ID>/contracts/$LINK_ID/"
# 预期: 204
```

### 13.2 验证 placeholder badge (B.3 PB-1)

创建 1 个 contract_no = `暂无` 或 `待签约`(Phase A import 时已生成,但浏览器测试可以创建一个):

```bash
# 通过 Django shell
docker compose -f docker-compose-local.yml exec api python manage.py shell <<'EOF'
from plane.db.models import Contract
from uuid import uuid4
ws = Workspace.objects.get(slug='<WORKSPACE_SLUG>')
c = Contract.objects.create(
    workspace=ws,
    contract_no='暂无',
    status='placeholder',
)
print(f"Created contract: {c.id}")
EOF
```

浏览器访问 list 页面:
- `暂无` / `待签约` 的 contract_no 应该显示一个特殊 badge(不是普通 text)
- 视觉效果:B.3 PR #18 加的 placeholder badge

## 14. 跑 import 命令 (非 dry-run,生产路径)

**只在确认上面所有 dry-run 测试都通过后再跑**:

```bash
# WSL 2 Ubuntu
docker compose -f docker-compose-local.yml exec api \
    python manage.py import_historical_project_data \
        /code/test-data.xlsx \
        --workspace <WORKSPACE_SLUG> \
        --created-by <ADMIN_EMAIL>
# 去掉 --dry-run,真的写 DB
```

预期:
- "Created N project(s)"
- DB 真的写入 contract / contract_project / project / projectmember 行

**验证 DB 写入**:

```bash
docker compose -f docker-compose-local.yml exec api python manage.py shell <<'EOF'
from plane.db.models import Contract, ContractProject, Project
print(f"Projects: {Project.objects.count()}")
print(f"Contracts: {Contract.objects.count()}")
print(f"Links: {ContractProject.objects.count()}")
EOF
```

## 15. 故障排查

### 15.1 Docker compose 起不来

```bash
docker compose -f docker-compose-local.yml ps
docker compose -f docker-compose-local.yml logs api
```

常见:
- `port 5432 is already allocated` → `lsof -i :5432` 找占用,kill 或改 port
- `database connection refused` → 等 postgres health check 跑完,或 `docker compose restart api`
- `permission denied` (volume mount) → `chmod 777` 或用 docker compose 自管理 volume

### 15.2 pytest fail

- `django.db.utils.OperationalError: could not connect to server` → db 容器没起,等 health check
- `IntegrityError` (F1 修复之前的版本) → 跑 migrate 重置
- `KeyError: 'is_unique_key'` → 旧 DEFAULT_PROJECT_CUSTOM_FIELDS 有这个 key,新版删了;确保 fork 在正确分支

### 15.3 pnpm install 失败

- `EACCES` → `sudo chown -R $USER:$(id -gn) ~/.npm ~/.local`
- `ECONNREFUSED` → 配 npm registry mirror (`npm config set registry https://registry.npmmirror.com`)
- `ENOSPC` → `df -h` 看磁盘空间

### 15.4 web dev 编译失败

- `Module not found` → `pnpm install` 重新装
- `Type error: '1' is not assignable to type 'TUserPermissionsLevel'` → 这是 PR #17 的 bug, 验证 fork 在 PR #20 之后 (allowPermissions 已修)
- `Type error: 'X' is not a valid ProjectMembership role` → 旧 import data, 删 DB 重 import

### 15.5 浏览器看不到 "New Contract" 按钮

- 不是 ADMIN 角色 → 切到 ADMIN user
- allowPermissions 错 → 跑 `python3 tools/check_viewset_decorators.py` 验证;如果是 `[1], 20` typo 还在,F1 修复没合入

### 15.6 import 命令 fail

- `FileNotFoundError: /code/test-data.xlsx` → `docker cp ...` 没跑;或路径错
- `Workspace.DoesNotExist` → 拼写错
- `User.DoesNotExist` → 邮箱错

## 16. 验证检查清单

跑完上面所有步骤后,确认以下 13 项都 OK:

- [ ] WSL 2 + Docker Desktop 验证 (1 节)
- [ ] git / Python 3.11 / Node 20 / pnpm 9 装好 (2 节)
- [ ] repo clone + checkout `claude/repo-code-summary-22f444` (3 节)
- [ ] `apps/api/.env` 生成 (4 节)
- [ ] Docker compose stack 起来,所有 container "Up" (5 节)
- [ ] `migrate --plan` 显示 0126 / 0127 已应用 (6 节)
- [ ] 后端 14 个 pytest 全 pass (7 节)
- [ ] workspace + admin user + project 创建 (8 节)
- [ ] import 命令 dry-run 成功 (9 节)
- [ ] `tools/check_viewset_decorators.py` exit 0 (10 节)
- [ ] 前端 pnpm install + pnpm dev 起来 (11 节)
- [ ] 浏览器 smoke: project-info 显示 17 个 field groups + 关联合同区块 (12.2)
- [ ] 浏览器 smoke: settings/contracts 显示列表 + "新建合同" 按钮 (12.3)
- [ ] 浏览器 smoke: detail 页面 + 编辑 + 删除 (12.4, 12.7, 12.8)
- [ ] 浏览器 smoke: 创建 contract 触发 CONFLICT_CONTRACT_NO toast (12.6)
- [ ] curl API smoke: 14 个 B.1 / B.2a / B.3 endpoint 测试 pass (13.1)
- [ ] placeholder badge 视觉测试 (13.2)
- [ ] non-dry-run import 写入 DB (14 节)
- [ ] 不在"边界纪律" 违反的文件修改过任何 Plane 原文件 (5 节 [不能改的] 列表)

**所有项都 OK = Phase B 完整可用**。

## 17. 完成后清理

如果不想保留测试数据:

```bash
# WSL 2 Ubuntu
docker compose -f docker-compose-local.yml down -v
# -v 把 volume 也删,数据清空
```

如果想保留数据给下次用:

```bash
# WSL 2 Ubuntu
docker compose -f docker-compose-local.yml stop
# 停 container,保留数据
```

## 18. 给未来 Agent / 自己的提示

按 [docs/internal-contract-project-relationship-implementation-2026-09.md#边界纪律](internal-contract-project-relationship-implementation-2026-09.md):

- ❌ 不要改 Plane 原 model / view / serializer
- ❌ 不要为了"看起来一致" 抽取公共基类
- ❌ 不要把 contract 端 import 加到 Plane 原 locale files
- ✅ 改自己 contract.py / contract/ 目录下的文件
- ✅ 新 i18n key 放 `contract.json`
- ✅ 新 endpoint 放 `urls/contract.py`

如果 1 行 contract 改动需要碰 ≥3 个 Plane 原文件 — **停下来 re-evaluate** 边界是不是破了。

---

**本手册终**。跑通上面的步骤 ≈ 完整验证 Phase B 全部功能,跟 fork 内部 PR #13 / #15 / #17 / #18 / #20 实际合并行为一致。
