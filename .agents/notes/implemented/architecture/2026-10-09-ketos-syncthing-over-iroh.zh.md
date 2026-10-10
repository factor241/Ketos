# Agent Note: 经 iroh 通道连接 Syncthing

Status: implemented

[English](2026-10-09-ketos-syncthing-over-iroh.md) | 中文

## Problem

10 月 16 日的演示让不同网络的两台计算机上的两个 Ketos 实例在同一个文件夹中协作：模型在一个 Ketos 的 `/workspace/shared` 中写下的文件，会出现在另一个 Ketos 的同一文件夹里。文件由 Syncthing 搬运，它需要 Ketos 提供三样东西：对方实例的设备 ID、与该设备共享的文件夹，以及一条规则：它的流量只经过团队的私有中继，不使用公共发现、不做 NAT 映射、不加入公共中继池。手工完成时，两个人要在两台计算机上的两个 Web 界面中粘贴设备 ID 和中继地址，并且每次重建 Syncthing 卷都要重来一遍。因此连接必须在邀请之后自动完成、每次重连时重复执行都安全、能跟随变化的设备 ID，并让 Syncthing 的网络设置只有一个写入者。没有 Syncthing key 的 Ketos 仍须保留通道与看板同步。

## Decision

**通道只传递设备 ID，配置由 Syncthing 的 REST API 完成。** 该功能是 `ketos-peer` 插件的一部分，由可选的 `Config.syncthing` 小节启用，演示环境的覆盖文件 `docker/stand/stand.patch.yml` 为其填值（`url` 为 `http://127.0.0.1:8384`、`apiKeyEnv` 为 `STGUIAPIKEY`、`relayAddress`、`folderId` 为 `ketos-shared`、`folderPath` 为 `/workspace/shared`）；没有该小节时功能不存在。每次 `ketos-peer/connected`（首次连接与每次重连）时，Ketos 从本地 Syncthing 读取自己的 `myID`，并作为帧 `7 syncthing.device` 发送，其 JSON 体恰为 `{ deviceId }`。收到的帧通过本地 Syncthing 的 `/rest/config` 路由应用：先写设备 `ketos:<peer id>`，其 `addresses: [relayAddress]` 且 `autoAcceptFolders: false`，再写类型为 `sendreceive`、开启监视器的文件夹（`fsWatcherDelayS`，演示环境为 1 秒）。设备 ID 只接受规范形式：八组、每组七个 base32 字符，第 14、28、42、56 个字符为 Luhn mod 32 校验字符，且最后一个数据字符的四个填充位为零，从而一个设备只有一种被接受的写法；Ketos 依据格式说明自行实现该校验。帧体为其他任何形式的帧，以及本机 Syncthing 自己的 ID，都会被丢弃并记录一行 `syncthing.device-invalid`。

**bootstrap 是 Syncthing 网络设置的唯一写入者，Ketos 只做检查。** `docker/stand/syncthing-bootstrap.mjs` 在每次容器启动时、Syncthing 运行之前改写 Syncthing 的 `config.xml`。其改动包括：全局与本地发现公告关闭、NAT 关闭、中继开启，`listenAddresses` 等于 `KETOS_SYNCTHING_RELAY` 加 `tcp://0.0.0.0:22000`，10 秒的重连间隔（`reconnectionIntervalS`，默认 20 秒），使 Syncthing 更快地重新拨向丢失的对等设备，以及 1 分钟的中继重连间隔（`relayReconnectIntervalM`，默认 10 分钟），使失效的中继连接在一分钟内重新拨号。缺少元素或缺少中继值会使容器停止。Ketos 从不写这些选项。Syncthing 应答后的第一次轮询（功能启动时，以及 Syncthing 停止应答后再次应答时）会读取 `/rest/config/options` 并比较：公告与 NAT 关闭、中继开启、私有中继位于监听地址之中（按不带 `token` 的 URL 比较，查询参数解码后不计顺序），且没有 `default` 或 `dynamic+` 监听地址（它们会加入公共中继池）。出现偏离时，共享文件夹状态变为 `error`，并记录一行 `syncthing.settings-diverge`，其中只列出设置名称，绝不包含地址。连接仍继续，因为无论 Syncthing 的发现设置如何，对等设备都只拨向中继地址。

**对等设备携带不含 token 的中继地址。** token 让监听方加入 `strelaysrv`；拨向监听方只需中继的地址与 ID。`stand.patch.yml` 在值到达插件之前从 `KETOS_SYNCTHING_RELAY` 中去掉 `token` 参数，token 保留在 bootstrap 写入的 Syncthing 自身监听地址里。Syncthing 每次启动都会把该地址（含 token）打印到标准输出，因此演示环境通过 `run-with-redacted-log.sh` 启动它：该脚本在一行写入 `/data/syncthing/syncthing.log` 之前改写其中的 `token=` 值，并在其读取进程停止时结束 Syncthing，而不是放过未脱敏的行。`syncthing.relayAddress` 为空、不是 `relay://host:port/?id=<relay device id>` 或带有 `token` 时，插件在加载时被拒绝。加载错误、host 日志行与请求错误只写字段、规则、请求路径和 HTTP 状态，绝不含 API key、token 或地址。

**连接是幂等、有序且串行的。** 每次对收到 ID 的应用都在同一个队列中运行。先写设备、后写文件夹，设备以完整的 PUT 体写入，因为 Syncthing 以默认值构造 PUT，并重置体中省略的字段。文件夹缺失时用完整体创建，否则用合并后的设备列表 PATCH。PATCH 会整体替换 `devices`，因此读取、合并与写入都在队列内完成，第二个参与者加入文件夹时不会挤掉第一个。设备按名称、地址和是否自动接受文件夹比较，文件夹设备列表按不含本机设备的集合比较；全部一致时，应用不发送任何修改请求。因此每次重连只产生读取开销，容器重启后卷上 Syncthing 自己的配置已保存着连接。有写入时记录 `syncthing.linked`。

**新的 Syncthing ID 取代旧设备。** Syncthing 卷被清空的对等方，会在同一个 Ketos 身份下宣告另一个 ID。以名称 `ketos:<peer id>` 找到先前的设备，并将其移出文件夹与配置（`syncthing.device-replaced`），因此设备列表不会增长。同一对等方的较新 ID 还会取代仍在队列中等待的较旧帧。

**被遗忘对等方的设备离开文件夹。** 已知节点文件不再列出该对等方后，`forget` 发出 `ketos-peer/forgotten`。随后，除本机设备外每个名为 `ketos:<peer id>` 的设备都离开文件夹与配置，使用同一个队列和同样的重试，并由 `syncthing.unlinked` 报告。否则，被遗忘的 Ketos 会继续双向同步共享文件夹。被拒绝的移除以一行 `syncthing.link-stopped` 停止，并保留该设备的配置；同一对等方在新邀请之后发来的设备 ID 会终止尚未执行的移除。功能关闭时，遗忘不发送任何 Syncthing 请求。

**长时间丢失之后的重连会重启 Syncthing 到未变化的对等设备的连接。** 到对等方的通道在再次连接之前已丢失至少 `kickAfterLostMs`（默认 90 秒）时，该连接的第一次应用若发现对等设备已以同一 ID 配置，则先暂停该设备（`POST /rest/system/pause?device=<id>`），再恢复它（`POST /rest/system/resume?device=<id>`，暂停失败时也恢复），并记录 `syncthing.reconnected`。在 Syncthing 2.1.5 中，暂停会关闭该设备的连接，恢复会立即拨号该设备。在一次断网 120 秒的 live 运行中，中继会话已结束，但通道恢复之后，B 的 Syncthing 仍把到 A 的已失效中继连接计为已连接约 84 秒，因此 B 报告文件夹已同步，而 A 的新文件并未到达。较短的中断不重启：Syncthing 的中继连接经受住了 20–65 秒的断网，而 Syncthing 在 2 分钟内最多强制重拨一个设备三次，之后暂停 5 分钟。丢失时长按墙上时钟从 `ketos-peer/disconnected` 量到下一次 `ketos-peer/connected`，因此首次连接以及之前没有丢失的连接都不重启。首次链接与被替换的设备同样不需要重启，因为 Syncthing 会自行拨号新设备；对等方在同一通道上再次发来的帧也不触发重启。Syncthing 把暂停存入其配置，因此重启作为应用步骤的一部分在链接队列中运行：暂停或恢复失败会使该步骤失败，重试时再次重启。每次应用还会在 Syncthing 报告对等设备已暂停、而其余配置一致时，以一次恢复请求恢复它，不做重启（`syncthing.device-resumed`）；因此因恢复失败或因 Ketos 停止而中断的重启所留下的暂停设备，会在下一次连接时被恢复，而未暂停的设备不产生任何请求。

**Syncthing 与 Ketos 并行启动，因此连接按失败类别重试或停止。** Syncthing 无应答、超时或返回服务器错误（5xx），以及任何不是 Syncthing 错误的失败（例如通道无法发出的帧），会每隔 `retryMs`（默认 2000 毫秒）重试该步骤并记录一行 `syncthing.retry`。其他任何 Syncthing 失败，例如被拒绝的 key（401、403）、其他客户端错误、格式错误的应答或启动后被移除的 API key，会以一行 `syncthing.link-stopped` 结束该步骤，通道的下一次连接再次启动两个步骤。对等方断开与插件释放会结束所有步骤。

**共享文件夹状态被轮询，跟随 Ketos 通道，并在对等状态路由上报告。** 监视器每隔 `statusRefreshMs`（默认 2000 毫秒）轮询一次，`GET /api/ketos.peer.state` 从内存中读取其最新结果，作为 `sharedFolder`。状态含义：Syncthing 无应答时为 `unavailable`；首次轮询之前、文件夹缺失或未运行、文件夹没有任何已连接的对等设备、已连接设备的对等方都没有 `online` 的 Ketos 通道（无论文件夹在同步还是空闲）、通道在线的对等方中没有一个的 Syncthing 回共享该文件夹时为 `waiting`；文件夹在扫描、传输或仍有所需条目且到某个已连接设备所属对等方的通道为 `online` 时，以及每个通道在线且回共享该文件夹的对等方仍有所需条目或待删除项时为 `syncing`；文件夹空闲、无所需条目，且文件夹的某个已连接设备带有名称 `ketos:<peer id>`、其对等方的通道为 `online`、其 Syncthing 回共享该文件夹且无所需内容时为 `synced`；Syncthing 拒绝请求或返回格式错误的 JSON、API key 已丢失、设置偏离或文件夹报告 `error` 时为 `error`。对等方一侧的情况来自其设备的 `/rest/db/completion`：对等方的集群配置共享并运行该文件夹后 `remoteState` 为 `valid`，`needItems` 加 `needDeletes` 按其索引统计对等方仍需要的内容。通道状况在每次读取状态时都从内存中重新读取，因此通道一旦丢失，`syncing` 和 `synced` 立即变为 `waiting`，无需等待下一次轮询，通道重新 online 后又变回去；`unavailable` 与 `error` 不取决于通道。Syncthing 有自己的死连接超时，在一次 live 测量中，它在断网 78 秒之后才把静默丢失的对等方报告为已断开，远晚于通道心跳发现它的时间，因此由通道裁决。功能关闭时该字段不存在。只有报告的状况发生变化时才记录日志行。

**没有 key 就没有该功能。** `apiKeyEnv` 指向一个环境变量，组装中有 credentials 服务时通过它读取，否则从启动环境读取，启动时读一次，之后每次请求前再读一次，不保留副本。该小节存在而启动时 key 未设置时，只有 Syncthing 功能保持关闭：一行 `syncthing.disabled` 日志（只写出变量名，key 读取失败时只说明无法读取 key，绝不写出读取方的错误文本）、不发出任何 Syncthing 请求、没有 `sharedFolder` 字段，而通道、看板同步与 transcript（文本记录）继续工作。key 在之后被移除时，状态变为 `error`。这是对「配置错误时明确失败」的有意例外：key 属于 Syncthing 的安装而不属于通道，因一个附加功能而拒绝插件会使正常工作的通道一并停止。小节本身的无效值，例如对非回环主机使用明文 `http://` URL、URL 中带用户名、无法使用的文件夹 ID 或相对的文件夹路径，仍会在加载时拒绝插件。

**Syncthing 保持为独立程序。** Syncthing 采用 MPL-2.0。演示环境镜像安装官方 2.1.5 归档（按架构以 sha256 固定），并附其许可证文本，由入口脚本在 Ketos 旁启动它。Ketos 只通过本地 REST API 访问它，不修改它，也不复制其任何代码。REST 客户端校验自己读取的字段并接受任何其他字段，因为这些应答是另一个程序的输出。

## Alternatives considered

- **在 Syncthing 的 Web 界面中手工连接设备。** 保留为演示的应急后备方案（[演示环境 README](../../../../docker/stand/README.zh.md) 中关于手动连接的一节），但不作为连接方式：两台计算机上的两个人各自粘贴对方的设备 ID，并把设备默认的 `dynamic` 地址替换为中继地址（发现关闭时 `dynamic` 什么也找不到），而且每次重建卷都要重做。
- **Syncthing 的全局与本地发现以及公共中继池。** 拒绝：全局发现公告会把设备 ID 和地址发布到团队不运营的发现服务器，公共中继池让 Syncthing 流量经过团队无法控制的节点，本地发现跨网络什么也找不到；演示不得依赖公共节点。
- **Syncthing 的 introducer 与 `autoAcceptFolders`。** 拒绝：它们让一个设备按 Syncthing 自己的规则向另一个 Syncthing 添加文件夹或设备。共享文件夹遵循邀请建立的信任，因此由 Ketos 自己在两侧创建文件夹，并以 `autoAcceptFolders: false` 写入每个对等设备。
- **由 Ketos 自己写 Syncthing 的选项。** 拒绝：这些选项会有两个写入者。bootstrap 在 Syncthing 运行之前改写文件，因此不存在 Syncthing 以出厂公共设置监听的时刻；运行时写入发生在 Syncthing 已按文件当时的内容启动之后，并且会覆盖运维人员的改动而不是报告它。
- **把中继 token 放进 `syncthing.relayAddress`。** 拒绝：token 是监听方的凭据。它会出现在插件配置和 Syncthing 界面中每个对等设备的地址列表里，而拨向对等方从不需要它。
- **仅凭 Syncthing 的连接状态报告 `synced`。** 拒绝：静默断开之后，文件夹会在一分钟以上的时间里保持 `synced`，而看板已把对等方显示为未连接。带有心跳的 Ketos 通道是更快的见证者，因此 `synced` 还要求它。
- **把失效的 Syncthing 连接留给 Syncthing 自己的超时。** 拒绝：live 断网 120 秒之后，文件夹在约 84 秒内显示 `synced`，而文件并未移动，通道却已重新在线。
- **每次通道重连都重启 Syncthing 的连接。** 经一次 live 运行后拒绝：约两分钟内的两次重连用尽了 Syncthing 的强制重拨，之后它暂停五分钟，而其中继重拨要等 `relayReconnectIntervalM`，文件夹在 211–350 秒内一直等待、文件不再移动。这些重启还断开了经受住 20–65 秒断网的 Syncthing 连接。
- **通道丢失期间仅凭 Syncthing 报告 `syncing`。** 拒绝，理由与 `synced` 相同：失效的连接使 Syncthing 的视图过时，因此只有不取决于对等方的 `unavailable` 与 `error` 优先于通道。
- **仅凭本地文件夹报告 `synced`。** 拒绝：对等方已添加本设备、但它自己的文件夹步骤失败或仍在重试时，本地文件夹空闲且无所需条目，状态会显示 `synced`，而对等方什么也收不到。因此 `synced` 还要求对等方的 `remoteState` 为 `valid` 且无所需内容。
- **key 未设置时拒绝插件。** 只在这一情形下被拒绝：Syncthing 功能是一条已经承载看板同步与 transcript 的通道的附加功能，缺少 key 由一行日志和缺失的 `sharedFolder` 字段报告。
- **嵌入 Syncthing 或复制其代码。** 拒绝：复制的文件会落入 Syncthing 文件的 MPL-2.0 义务，并让 Ketos 负责上游修复。独立且校验和固定的程序，通过升级固定的归档来更换。

## Consequences

两个 Ketos 在一次邀请之后连接各自的 Syncthing：无人打开 Syncthing 界面，这一交换在每次重连时作为只读检查重复，重建的 Syncthing 卷会在下一次重连时被接上。共享文件夹所信任的恰是通道所信任的：已知对等方的设备 ID 按所发送的原样应用，因此配对的 Ketos 可以把它选择的任意 Syncthing 设备加入共享文件夹。按人权限、worktree 与「仅远程访问」模式在演示之后到来，Syncthing 界面的密码也是如此；该界面在容器内无密码监听，演示环境只把它发布到 `127.0.0.1`。该界面在内存日志和监听地址选项中保留着未脱敏的中继 token，因此任何能访问它的人都能读到 token；日志文件的脱敏不覆盖这一点。

丢失至少 `kickAfterLostMs` 的中断，由 Ketos 通道再次连接时重启 Syncthing 到对等设备的连接来处理。通道保持在线期间失效的 Syncthing 中继连接，或在更短的中断中失效的中继连接，在 Syncthing 自己发现丢失之前一直被计为已连接：Syncthing 最多每 90 秒发送一次协议 ping，并关闭 300 秒内什么也没收到的连接（该检查每 150 秒运行一次），除非中继或 TCP 连接更早失败。只有在关闭之后，Syncthing 才经中继重新拨号该设备，在演示环境中最多每分钟一次（`relayReconnectIntervalM=1`）。由于每次应用都会恢复已暂停的对等设备，在 Syncthing 界面中暂停的 `ketos:<peer id>` 设备会在该对等方的下一次通道连接时被恢复；要停止与它同步，应遗忘该对等方。

只有一个文件夹：该小节只命名一个 `folderId`，每个已连接的对等设备都加入它。对等设备只拨向私有 Syncthing 中继，它是 VPS 上与 iroh 中继不同的另一个程序，因此它宕机时两台计算机之间无法建立新的 Syncthing 连接，而通道与看板同步经 iroh 中继继续运行。

偏离的 Syncthing 设置会显示为 `error`，但不会停止连接。被 Syncthing 拒绝的步骤（例如 API key 错误）不会重试：key 修复后状态在下一次轮询恢复，设备在通道下一次连接时连接。在 Syncthing 界面中被改名的设备，在对等方 ID 变化时不会被识别为该对等方先前的设备，在对等方被遗忘时也不会被移除，文件夹也永远不会到达 `synced`，因为该状态需要名为 `ketos:<peer id>` 的已连接设备。所有卷都被清空后以新身份回来的 Ketos 是一个新的对等方，因此其旧身份的设备留在文件夹中，直到遗忘那个旧对等方。`synced` 反映的是本 Syncthing 已收到的索引：连接刚建立、对等方的索引到达之前，没有内容要发送的一方可能短暂显示 `synced`，尽管对等方持有尚未通告的文件。REST 客户端依赖固定的 Syncthing 2.1.5 的语义，即 PUT 重置被省略的字段、PATCH 整体替换 `devices`，以及文件夹如何被规范化；升级固定版本意味着要对照下文所述的内存替身重新检查它们。

## Testing

`packages/ketos/peer/tests` 中的 `syncthing-*.spec.ts` 覆盖设备 ID 校验、小节校验与设置比较、REST 客户端、连接、共享文件夹状态，以及功能启动与 key 查找，每个文件的覆盖率为 100%。它们运行在 `syncthing-fake.ts` 之上，这是 Syncthing 2.1.5 REST API 的内存替身，具备 API key 校验、缺失文件夹或设备时返回 404、以默认值构造的 PUT、整体替换 `devices` 的 PATCH，以及文件夹规范化。连接规格固定了以下行为：重复帧不发出任何修改请求，只重写已存字段发生漂移的设备，帧与连接同时到达时只做一次文件夹 PATCH 且不丢设备，ID 变化后替换设备，被遗忘对等方的设备先离开文件夹再离开配置，通道丢失至少 `kickAfterLostMs` 之后对未变化设备的暂停与恢复，以及较短丢失之后、首次连接、首次链接、ID 变化和重复帧时不做暂停与恢复，暂停失败之后的恢复、恢复失败时的重试、对已暂停的一致设备只做一次恢复而不重启，按失败类别重试或停止，以及日志行和错误中不出现 key 与中继 token；设备 ID 规格拒绝每个真实 ID 的 15 种填充位被置位、解码后字节相同的写法。`syncthing-pair.spec.ts` 在内存传输上运行两个真实的对等节点，各自配一个替身，覆盖经通道的连接、短暂丢失后重连时的只读复查、丢失 95 秒之后每侧一次暂停与恢复、卷被清空后的替换、较晚启动的 Syncthing 之后的连接、被遗忘对等方设备的移除，`sharedFolder` 字段从 `waiting` 到 `synced`，对等方的 Syncthing 尚未建立该文件夹时的 `waiting`，以及 Ketos 通道丢失而 Syncthing 仍报告对等方已连接时的 `waiting`；`syncthing-state.spec.ts` 固定了两次轮询之间 `syncing` 与 `synced` 变为 `waiting` 再变回的行为、`unavailable` 与 `error` 优先于通道，以及对等设备每种远端状态与所需内容的映射。`docker/stand/tools/syncthing-bootstrap.test.mjs` 覆盖首次运行、原样重跑、更换中继会替换旧监听地址，以及模板漂移和缺少中继时的失败；`docker/stand/tools/stand-patch.test.mjs` 覆盖从中继地址去掉 token，`run-with-redacted-log.test.mjs` 与 `docker-entrypoint.test.mjs` 覆盖日志脱敏与 Syncthing 的启动。在带 relay-only 覆盖文件的双容器演示环境中，邀请被接受 0.8 秒后两个 Syncthing 完成连接，模型在一个 Ketos 上写下的文件在 2.3 秒内到达另一个 Ketos，一个容器重启 4.6 秒后双方通道重新 online 且无需新的邀请，被清空的 Syncthing 卷在其容器启动 3.5 秒后被替换并重新连接。

## Related

- [`@ketos/peer` README](../../../../packages/ketos/peer/README.zh.md)：`syncthing` 小节、帧 `7`、状态值、日志行与已知限制。
- [Ketos 对等通道](2026-10-06-ketos-peer-channel.zh.md)：承载该帧并固定私有 Syncthing 的通道。
- [`docker/stand/README.md`](../../../../docker/stand/README.zh.md)：演示环境的 Syncthing、其 bootstrap 与手动连接后备方案。
- [`docker/relay/README.md`](../../../../docker/relay/README.zh.md)：私有 `strelaysrv` 中继及其 token。
