# Hara 同事 admission-auth S0+S1 合同

purpose：`candidate-admission-auth-s0s1`，仅文档、单元合同与合成哨兵标签。
实施派单 SHA256：`f05a8aad9db876d4cc68b126eaf8a3f274559a5637b276e02f03fad7a0842d7d`。
只读方案 SHA256：`a4a294605a471d8b0dfad6ae60a9f7305fc7c98facb26e5aad26803f29637a74`。

## 认证边界

Hara 同事的 admission 子进程先取得 `gateEvidence().environment()` 的净环境，
再仅回注父环境的一条 `GH_TOKEN`；父环境未提供主键（含空字符串）时，使用 `GITHUB_TOKEN`
作为来源，仍只映射为子环境中的 `GH_TOKEN`。

`policyGet` 是唯一生产调用面。其既有三族 endpoint 正则、固定仓库和 `gh api --method GET`
保持原样。无认证时在启动 gh 前拒绝；失败消息不包含 token、子进程输出或响应正文。
该通道不接受命令、method、任意 URL 或调用方额外环境覆盖。
认证子环境固定 `GH_HOST=github.com`，`GH_CONFIG_DIR` 指向证据私有 HOME 的配置目录；
父环境同名大小写别名不能把凭证路由到其它主机或用户配置。此为非密钥上下文固定，
回注的凭证键仍仅 `GH_TOKEN`。

`APPLE_*`、`AWS_*`、私钥、npm auth、SSH agent、其它 TOKEN/SECRET/CREDENTIAL 等继续剥离。
通用 `sync`、`run`、升级、构建和签名继续使用默认净环境；全局剥密正则保持原字节。
P2（改名绕过滤）不采用，P3（全局放行 GH_TOKEN）不采用。

S1 通过合成父环境、真实 Node 布林哨兵子进程及对 gh spawn 的本地替身验证环境传递。
不调用真实 gh，不发网络请求，不读真实凭证或 Keychain，不写真实 `~/.hara`。
此处仅证明调用面是只读 GET；token 的实际权限矩阵属于 S2，尚未探测。

## 源与交接边界

本 draft 从 O‴ `91b38651226d927aa3a817bd07d5cc2bbcd106e4` 派生，改动保留为未提交源码。
draft 的 HEAD 仍指向基线；工作树字节已变化，不能将其当成冻结 O‴ 或新 live 身份。
冻结 orch、A⁗、Core 和 exact12 只读保留。

本片不创建新 tip、wiring review 或 permit，不复用 `e42c25e9…` 或任何历史 digest。
不做 S2/S2b/S3/S4、候选 live、push/tag、环境批准、签名、公证或正式发布。
run `40123878973` 保持 completed/failure，不补签、不重跑。

验收记录：`admissionChildHas=true`，`nonAdmissionChildHas=false`，零网络、零真实 gh，
`candidateReady=false`。下一停点：`await-S2-dispatch`，按 S0S1 复审交接。
