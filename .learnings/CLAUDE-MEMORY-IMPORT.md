# Claude 记忆导入（从 nanhara 会话记忆分流而来）

> 2026-08-27 迁入。这些条目原本存在 `~/.claude/projects/-Users-zhujianbo-work-projects-nanhara/memory/`，
> 只有从 nanhara 根目录起的会话看得见 —— 而它们讲的是**本仓**的事。
> 现在放这里：进 git，Codex 和任何从本仓起的会话都能读到。
> 原件已归档到 `memory/.migrated-2026-08-27/`（可回滚）。
> ⚠️ 记忆是**写下时**的观察，不是实时状态。引用前先对当前代码验证。

---

## reference_hara_mac_signing_pipeline

**摘要**：hara 桌面 macOS 签名公证产线:本地签定案、密钥位置、构建命令、五个坑

# hara 桌面 macOS 签名公证(2026-07-11 打通,Jeff 定案:本地签)

**决策:发版本地签,Apple 私钥永不上 GitHub secrets**(Jeff 2026-07-11 明选;以后发版频率高/多人协作再评估 CI 签)。

## 发版命令(在 Jeff 的 Mac)

```bash
cd ~/work/projects/hara/hara-desktop && ./scripts/build-mac-signed.sh
```
产物:签名+公证+staple 的 `Hara_x.y.z_aarch64.dmg` + updater tar.gz/.sig。CI(tag 触发)继续出 Win/Linux + 未签 mac;发版时用本地签名产物**覆盖** release 里的 mac 资产,并同步改 latest.json 里 mac 条目的 signature(取本地 .sig 内容)。

## 密钥/证书位置(全在本机)

| 物件 | 位置 |
|---|---|
| Developer ID Application 证书 | 登录钥匙串,`Wuxi Nanhara Technologies Co., Ltd. (4GMBSXJ67T)`,**2027-02-01 到期要续** |
| 证书私钥(续期也用它) | `~/.tauri/hara-devid-2026.key`(0600,勿删) |
| 公证 ASC API key p8 | `~/.tauri/asc-key-LPV3VLR842.p8`(key_id `LPV3VLR842`,issuer `69a6de87-a919-47e3-e053-5b8c7c11a4d1`;源头=NayiApp `ios/fastlane/api_key.json`,团队通用) |
| updater 签名私钥 | `~/.tauri/hara-desktop.key`(无密码) |
| ASC 档案 | app `Hara : AI Agent Workspace`,Apple ID 6789824706;详见 `tools/aso/hara/setting.md` |

## 五个坑(踩过的)

1. **Entitlements 必须有 JIT 豁免**:`src-tauri/Entitlements.plist`(allow-jit / allow-unsigned-executable-memory / disable-library-validation / allow-dyld-environment-variables)——bun/JSC sidecar 在硬化运行时下没它必崩。
2. **签名身份不进 tauri.conf**:走 `APPLE_SIGNING_IDENTITY` 环境变量(脚本里),否则无证书的 CI mac runner 构建直接失败。
3. **dmg 容器要单独公证**:tauri 只公证 .app;dmg 还要 `notarytool submit + stapler staple`,否则 `spctl -t open` 对 dmg 显示 rejected(脚本已含)。
4. **updater 签名要显式空密码**:`TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`,不设会报 "incorrect updater private key password: Device not configured"。
5. **sidecar 要从干净树构建**:hara-cli 工作区常有其他会话 WIP,build 前 `git stash push -u -- <WIP文件>`,否则半成品代码进发行版二进制。

## 验证三板斧

```bash
spctl -a -vv Hara.app                    # accepted · Notarized Developer ID
xcrun stapler validate Hara.app          # worked
spctl -a -t open --context context:primary-signature -v <dmg>  # accepted
```

相关:[[project-hara-desktop-initiative]] · Mac App Store 不上架(沙箱与本地 agent 冲突),ASC 建号=占名

## 发版合流步骤(v0.1.2 实战定型,2026-07-11)

tag 推后 CI 出全平台(mac 未签)→ 本地 `SKIP_SIDECAR=1 ./scripts/build-mac-signed.sh`(sidecar 提前从**干净 clone** 构建:`git clone --branch vX.Y.Z file://本地repo` + bun install + bun run build + bun scripts/build-binary.ts,**别再 stash 共享树**——另一会话可能正活着改文件)→ 等 CI 全完(先动 latest.json 会被后完成 job 改写)→ `gh release upload --clobber` 三件(dmg / Hara_aarch64.app.tar.gz / .sig;⚠️ `upload file#label` 的 # 是显示标签**不改资产名**,要先 cp 成目标名)→ 下载 latest.json 把 darwin-aarch64(+-app)的 signature 换成本地 .sig 内容再 --clobber → 公网 curl 下 dmg 跑 `spctl -t open` 终验。Intel(x64)mac 包目前仍未签(本地是 arm 机,cross 签名待需求)。Windows 暂不买证书(SmartScreen 点两下能过,等量起来再上 Azure Trusted Signing $9.99/月);Linux 无守门机制不需要。

**分发渠道决策(2026-07-11)**:OSS 镜像 + 官网 OS 探测下载区**均暂不做**(零国内反馈时不预优化,产品第一)。触发条件=国内下载失败反馈 / 国内推广期 / CN 自动更新失败 → 届时 OSS 传包 + tauri updater `endpoints` 数组加 OSS 兜底(原生支持多端点)+ 官网双链。官网 hero 注释已改为 signed & notarized + Windows SmartScreen 提示。

**发版两脚本定型(v0.1.3 起)**:①`scripts/build-mac-signed.sh`(构建+签名+公证)②`scripts/release-mac-assets.sh <tag>`(CI 完成后:签名件 clobber + latest.json 修签名 + 公网 spctl 终验)。v0.1.3=UI polish(大写 Hara 字标+logo 进侧栏/启动页+紧凑时间戳+bot 行去来源重复),三连发全走通。

**⚠️ 合流竞态实锤(v0.1.5)**:CI 未跑完就 clobber,后完成的 mac job 把未签版盖回来(公网终验 rejected 逮住);修复=release-mac-assets.sh 已加**硬闸**:合流前 gh run 校验该 tag CI `completed success`,否则拒跑。轮询窗口至少 10 分钟起。

## Windows 签名(2026-07-12 起动)

**选型定案**:SignPath Foundation 免费 OSS 签名(**Azure Trusted Signing 中国主体不可用**——组织验证仅限美/加/欧盟/英;商业 OV ~$200-400/年做备选,触发=Windows 付费用户/品牌要求发布者=南荒)。发布者将显示 "SignPath Foundation"(开源惯例)。**申请已提交(2026-07-12,Jeff 本人在真实浏览器提交**,自动化填表被权限分类器正确拦下——外部身份提交须本人;联系人 Jianbo Zhu / jefftkoai@gmail.com)。前置已备:hara-desktop 补 LICENSE(Apache-2.0 同 hara-cli)+ README 加 SignPath 致谢行(其硬条件:下载页须提及)。
**后续流程**:数天人工审核 → 邮件邀请开 SignPath.io 账号(用 Jeff 真实浏览器登录)→ CI 集成(GH Actions 出未签 exe/msi → SignPath 云签 → 回传 release,含 latest.json 的 windows 签名条目同步)→ 每次发版在 SignPath 后台人工批一次。⚠️ 盯 jefftkoai@gmail.com 的 SignPath 邮件。
