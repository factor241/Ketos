# Agent Note: Fork-owned CI for factor241/Ketos

Status: implemented

[English](2026-10-03-ketos-fork-ci.md) | 中文

## Problem

阶段 22 的 MVP 验收没有任何来自 fork 的 CI 信号。上游 `ci.yml` 的 Linux 与 Windows 任务固定在组织级 enterprise runner（`dsh-ubuntu-24-04-16core`、`dsh-windows-2025-16core`）上，并通过 fork 未设置的 `DSH_CI_FAILOVER_*` 变量解析备用池，因此这些任务永远停在队列中；`ci-master.yml` 监听 `master` 推送并运行在 self-hosted 池上；E2E 工作流在到达测试之前就死亡，因为固定的 `bubblewrap_0.9.0-1ubuntu0.1` 载荷已从 `archive.ubuntu.com` 消失；fork 中也没有任何 secret。验收只能依赖本地门禁。

## Decision

fork 拥有一个 CI 工作流 [.github/workflows/ketos-ci.yml](../../../../.github/workflows/ketos-ci.yml)，并禁用无法运行的上游基础设施工作流。

- `ketos-ci` 在 `push` 到 `main`、`pull_request` 进入 `main` 以及 `workflow_dispatch` 时触发。其 `linux / node 24` 任务运行在 `ubuntu-24.04` 上：`pnpm install --frozen-lockfile`、`scripts/prepare-ci-bubblewrap.sh`、`pnpm run build`、`typecheck`、`lint`、`test:gui`、`doc-sync`、`hygiene` 以及 `DSH_SNAPSHOT=replay pnpm run test:web:built`。并行度取值与 ci-master.yml 合并式拓扑的 4-core 行一致。
- 同一工作流的 `coverage` 任务仅在每日定时和手动 dispatch 时运行 `pnpm run test:coverage`；pull request 跳过它。
- [scripts/prepare-ci-bubblewrap.sh](../../../../scripts/prepare-ci-bubblewrap.sh) 优先从 Launchpad 下载固定载荷，并保留 `archive.ubuntu.com` 作为备用。版本与 SHA256 固定值不变，`sha256sum --check` 仍然强制。
- [.github/workflows/e2e.yml](../../../../.github/workflows/e2e.yml) 的 E2E preflight 将缺失的 `DEEPSEEK_API_KEY_EXTERNAL` 报告为警告而非失败。无密钥运行时所有真实 API 用例自我跳过；配置 secret 后恢复真实运行。
- 缺少 secret、environment 或 runner 的基础设施工作流记录在 [docs/ketos/ci-fork.md](../../../../docs/ketos/ci-fork.md)：其中 7 个通过 `gh workflow disable` 禁用；另有 11 个文件尚未被 GitHub Actions 注册到 `main`，无法通过 API 禁用，也不会在 pull request 或 `main` 推送时触发。上游 `ci.yml` 与 `ci-master.yml` 保持逐字节不变，作为未来上游验收的参照。

## Alternatives considered

**通过 `DSH_CI_FAILOVER_LINUX` 重定向上游 `ci.yml`。** 将该变量设为 `blacksmith` 需要 Blacksmith 账户，设为 `selfhosted` 需要上游组织的内部池；对 `ci.yml` 的任何修改还会在每次上游同步时冲突。放弃的是：fork 将继承一个为其并不拥有的机群设计的工作流。

**为 fork 运行 self-hosted runner。** 放弃的是：为一个产品检查点运营机群不值得其基础设施成本；公开 fork 的标准托管 runner 是免费的。

**保留所有上游工作流启用。** 放弃的是：pull request 永远携带排队中或红色的基础设施检查，掩盖真正有效的门禁。

**把 bubblewrap 下载改为当前的 `0.9.0-1ubuntu0.3` 载荷。** 放弃的是：固定 SHA256 会随每个 Ubuntu 点版本变化，而门禁需要固定且经过验证的字节载荷。

## Consequences

`ketos-ci` 是 fork 的必需 Linux 信号，必须跟随上游 `ci.yml` 的门禁清单变化。Windows、Python runtime 矩阵、benchmarks 与 self-hosted standby 在 fork 中不被覆盖；本地 Wine 门禁仍是 Windows 诊断手段。无密钥 E2E 报告为绿色而所有真实 API 用例自我跳过——这是 `DEEPSEEK_API_KEY_EXTERNAL` 配置之前的可接受状态。两个上游文件带有已记录的 fork 改动，登记于 [docs/ketos/upstream-sync.md](../../../../docs/ketos/upstream-sync.md)：`scripts/prepare-ci-bubblewrap.sh`（Launchpad 优先下载）与 `.github/workflows/e2e.yml`（警告式 preflight）。[上游真实 API CI 记录](../testing/2026-06-19-real-api-e2e-ci.zh.md) 保留其上游设计，并与本记录互相链接。

## Testing

`ketos-ci` 在每个 pull request 上运行其门禁；bubblewrap 改动保留了强制的 SHA256 校验，且 `bash -n scripts/prepare-ci-bubblewrap.sh`、`actionlint` 与 `pnpm run doc-sync` 在本地通过。

## Related

- [.github/workflows/ketos-ci.yml](../../../../.github/workflows/ketos-ci.yml) — fork 工作流。
- [docs/ketos/ci-fork.md](../../../../docs/ketos/ci-fork.md) — 运行什么、禁用了什么、如何恢复、如何添加 E2E 密钥。
- [Real-API e2e in CI against the external DeepSeek API](../testing/2026-06-19-real-api-e2e-ci.zh.md) — fork preflight 偏离的上游设计。
- [docs/ketos/upstream-sync.md](../../../../docs/ketos/upstream-sync.md) — 分歧账本。
