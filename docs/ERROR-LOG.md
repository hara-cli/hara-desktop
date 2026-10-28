# Error log

## live34 Core suite · Actions env leak into local-only preflight/Gate A fixtures · 2026-10-28

Hara 同事：live34 run `40649151587` attempt2＠tip `31eb2d25…` 四平台 Core native full suite 全挂：共同 `# fail 2`＝`test/candidate-local-aarch64-preflight.test.mjs` 的 `runPreflight…` 与 `Gate A publish/prepare…`；Win 另 +4（POSIX 0700／0600 断言＋`saveRetainedNotary` runnerDirectory 可写位）。根因：① `bareEnv()` 只剥 evidence 根，未剥宿主 `GITHUB_ACTIONS`／`ACTIONS_RUNTIME_TOKEN`／`GITHUB_RUN_ID`，Actions 上 `assertNotActions`／`attestRun` 误拒；② Gate A 测例直接读写真实 `process.env`，未像 `candidate-policy-proof.test.mjs` 那样清／还 Actions 标记；③ 0700／mode 断言在 win32 无 `getuid` 时无意义且 chmod 不稳。修法（分支 `fix/live34-core-suite-test-env-20261028`）：`bareEnv`＋`withClearedActionsEnv` 清上述三键；Gate A 绿路径包在 cleared env 内，仅测拒绝时再设 `GITHUB_ACTIONS`；`assertLocalPreflight`／`privateDirectory`／`saveRetainedNotary` 路径的 mode／owner 检查对齐既有 `getuid` 平台化；测内 0600／0700／notary mode 断言仅在 POSIX 执行。**未**合 harden／未放宽 Gate A 生产拒绝／未动 tag／PEM。教训：本地-only 闸的测例不得继承宿主 Actions 标记；POSIX mode 断言必须平台化。

## live33 sign_apps durableNotary outside evidence whitelist · retained notary.json · 2026-10-28

Hara 同事：live33 run `40635788770`＠tip `10ab222d…` 的 `sign_apps`（job `122662099416`）钥匙串解锁＋四端 App codesign／Developer ID 校验已过、`ditto` 已写出 `submission.zip` 后，在 `durableNotary`→`save(statePath)` 报 `AssertionError: outside evidence whitelist`（`candidate-upgrade.mjs:63`／`candidate-common.mjs:save`／`candidate-signing.mjs`）。根因：`gateEvidence` 白名单只允 `$CANDIDATE_EVIDENCE_ROOT/{synthetic-home,tmp}`，而跨 job 耐久的 retained notary 故意写在 `$HARA_CANDIDATE_RUNNER_DIRECTORY/_candidate-notary/.../notary.json`；`save()` 一律走 evidence 闸 → retained 路径必然炸；**未达 notarytool**（非 Keychain／GH_TOKEN／Apple notary／缺文件）。修法（分支 `fix/live33-notary-evidence-whitelist-20261028`）：新增 `saveRetainedNotary(file, value, runnerDirectory)`——仅允许 `runnerDirectory/_candidate-notary` 下原子写（wx＋fsync＋rename，可替换轮询态），不经 evidence 白名单；`durableNotary` 的 retained `notary.json` 改走该 helper，公开 `app-notary.json`／`dmg-notary.json` 仍 `save()`。**未**放宽 `gateEvidence`／未把 runner 根加入 evidence 白名单。孤儿 `submission.zip`（无 `notary.json`、Apple 侧无 submissionId）已按 Jeff 明文删除，避免下次 `COPYFILE_EXCL` 撞车。教训：跨 job 耐久态与 run-scoped evidence 必须分写路径；retained 写失败不得误判成凭证／notary 故障。诊断 SHA `82e93508…`。


## v1.1.0 tag prepare_release · npm test without retained evidence · 2026-10-28

Hara 同事：tag build run `40629216060`＠tip `dc702559…` 的 `prepare_release`「Run release-pipeline regression tests」裸跑 `npm test`，`# fail 33`／`# pass 1326`，全部是 `explicit canonical evidence path required`（`gateEvidence` ← `candidateEvidence`）。根因：evidence 闸落地后，`ci.yml`／`candidate.yml` 都先 provision retained evidence 再跑全量，`build.yml` 的 prepare_release 和 signing-host 重跑测试这两步没有跟上（v1.0.2 起 tag build 一直红，上次绿是 evidence 闸之前的 v0.1.187）。修法：这两步改用与 `ci.yml` 相同的 `provisionCiEvidence`＋`withCiEnvironment`＋`run(…'exec npm test'…, logFile)`，leaf 为 `release-evidence-<run>-<attempt>-{prepare,signing}`，放在 `GITHUB_WORKSPACE` 下，cleanup keep，不用 `/tmp`、`~/.hara` 或 `RUNNER_TEMP`。prepare 的 leaf 在 checkout 里，用 `.gitignore` 的 `/release-evidence-*/` 屏蔽，后面 source-pack 的 `git status --porcelain` 干净树闸不变。signing leaf 放在 run-scoped source root 旁边，不在 Desktop checkout 里，`build-mac-signed.sh` 的干净树闸也不变。`gateEvidence` 的词法检查和 forbidden 前缀都没有放宽。本地：裸跑 33 fail（与 CI 完全一致），包装后 0 fail。教训：凡是跑全量 `npm test` 的 workflow 步骤都必须走同一 evidence provision，新增调用方时要同时补 workflow 测试（`test/ci-workflow-provision.test.mjs`）。诊断 SHA `46bf6d04…`。

## live32 Intel Core full · legacy-copy 120s file deadline ＋ cold first Chromium launch · 2026-10-28

Hara 同事：live32 run `40623153575`＠tip `dc702559…` 的 `candidate-build-x86_64-apple-darwin`（job `122612211038`）Core full 出现 2 个 failed group。① `legacy-copy-roundtrip.test.mjs` 文件超时 120000ms（wall 153.7s；aarch64 同 tip 51.3s）。这是纯 durable fsync fixture，本轮 Intel/ARM 比值 3.00×，durable 文件普遍 2–3.1×。同一文件在早先的 Intel strict 跑过 56.6s、91.0s，也在 live24 超时过：同一个 120s 期限下主机差异就有约 2.7 倍，不是 Core 回归（`ad1ced4..29ecc4ac` 没有改这个测试或它的 helper）。② `presentations.test.mjs` 第 1 例在 61.06s 报 `Presentation PDF rendering timed out safely.`，正好是 Core 产品 `PDF_RENDER_TIMEOUT_MS=60000`。这是 VM 里第一次真实启动 Chromium（`web.test` 用的是假浏览器）；同文件后面的直接渲染只要 6.0s。aarch64 首启 9.7s、热启 2.9s，模式相同。export 和直接渲染走同一个 `renderPresentationPdf`，所以假设「export 路径／长 TMPDIR」不成立，排除。修法（仅 Desktop，不升 Core pin）：x64 Mac 的 Core full 改由 `scripts/candidate-core-native-tests.mjs` 执行。它复用 pinned Core 自己 review 过的 `nativeTestBatches`：Core 点名的 12 个 `INTEL_SLOW_FILES` 用 300s 文件期限，其余 331 个文件仍是 120s，用例期限不变（剥离 `HARA_INTEL_TEST_BUDGET`）。与 strict 批次只要有期限以外的差异就拒绝。测试前通过 Core 自己的 `renderPresentationPdf` 做一次有界、不计入判定的 Chromium 首启预热，产品 60s 预算不变。receipt 新增 `deadlines: intel-slow-file-300s-v1` 如实披露。aarch64 仍用 Core `--original-deadlines`，字节不变。**这是对 E3「期限不放宽」的有界例外，须 Elon 审、Jeff 明文认可。** 本地无法跑真实 Intel：批次已对真实 Core `29ecc4ac` 快照校验（12/324/7，343/343），预热已用真实 Chrome 加 pinned Core 在 arm64 实跑通过（5.2s）。Intel 是否转绿要等下一次 candidate。教训：Intel runner 的文件期限要按实测比值和主机差异留余量；首次启动外部浏览器的成本不能算进产品单次预算。诊断 SHA `46bf6d04…`。

## Candidate kicks found aarch64 failures only on hosted runs · local preflight gate · 2026-10-28

Hara 同事：live27–live31 多次在 hosted run 里才暴露测例／构建失败，每次都要消耗一个 O＋proof＋kick。缺口：kick（raw `git push` 受控 ref）与 Gate A `publish`／`prepare` 之前没有本机验证，且 `candidate-native.mjs` 的 `context()` 硬要求 Actions 事件，本机无法直接跑（禁伪造 CI context）。修法（分支 `feat/local-aarch64-preflight-gate-20261028`）：新增 `scripts/candidate-local-aarch64-preflight.mjs run|check`，在 Apple Silicon 本机经 `provisionCiEvidence` 私有证据根复用 hydrate→tests→sidecar→build，全绿才写 0600 receipt，绑定 HEAD／tree／inputs／pins，有效期 12h；`candidate-policy-admin.mjs` `publish`／`prepare` 在任何 gh 调用之前校验 receipt，拒绝时打印原因；新增 `scripts/candidate-controlled-ref-push.mjs`（`--confirm-kick`＋FF-only，禁 force／tags）作为唯一 kick 路径；umbrella `candidate-publish.sh` 先跑 `check`。`candidate.yml` 四平台不变；签名／notary／env／admission 加密不变。教训：kick 前先本机 aarch64 全绿；receipt 只是本机闸门，不是授权。

## live31 Win orch suite · actions-gh-auth fixture needs host `zip` · 2026-10-28

Hara 同事：live31 run `40618804244`＠tip `902a080c…` 的 Windows job `122593947310`「Orchestration original full suite」exit=1，`# fail 2`＝父子 TAP：`downloadArtifact list and zip children both receive GH_TOKEN only`（`test/candidate-actions-gh-auth.test.mjs` 用 `realSpawnSync('zip',…)` 造 envelope，status null≠0）＋父 subtestsFailed。根因：Windows runner 无 `zip` CLI，测例造夹具时依赖它，失败发生在 `downloadArtifact` 运行之前；生产路径（`githubReadEnvironment`／`api`／`downloadArtifact`／`unzip`）无故障，Linux 同 tip 全绿。修法（分支 `fix/live31-win-actions-gh-zip-20261028`，仅测改）：测内纯 Node `storedZip`（stored、单条 `payload.txt`、`zlib.crc32`＋中央目录）替代 host `zip`，生产仍用真实 `unzip -Z1`／`-q -d` 校验扁平 envelope；GH_TOKEN 回注断言不变，不跳过 win32，不放宽 scrub、不加 TOKEN 进 `preservedHara`。**非**回滚 live30 窄通道。教训：测试夹具不得依赖 runner 未保证的 CLI（`zip` 不在 Windows 镜像）；本机可用 PATH 去掉 `zip` 复现。同 run rerun 带不上新 tip。诊断 SHA `130c3dcf…`，问题记录 `inbox/2026-10-28-live31-win-actions-gh-zip-problem-record.md`。

## live30 sign_apps GH_TOKEN strip → gh exit 4 · Actions artifact api · 2026-10-28

Hara 同事：live30 run `40608521865`＠O³³ tip `7d9fb49c…` 的 `sign_apps`（job `122568463767`）Keychain unlock 成功后在 `downloadArtifact`→`api`→`sync('gh','api',…)` 报 `candidate command failed: gh (4)`。根因：`gateEvidence.environment()` 通用剥密把 workflow 已给的只读 `GH_TOKEN` 一并删掉，`gh` 无认证退出 4；artifact／Keychain／权限本身无故障。**同类复发**（live／LP2 admission `gh api` exit 4，当时以 `admissionGhEnvironment` 窄通道修）。修法（分支 `fix/live30-sign-apps-gh-token-20261028`）：把 admission 的窄通道抽成 `candidate-common.mjs` 的 `githubReadEnvironment`（先剥密，再只回注一个 `GH_TOKEN`，优先父 `GH_TOKEN`、否则映射 `GITHUB_TOKEN`；固定 `GH_HOST=github.com`＋私有 `GH_CONFIG_DIR`），`admissionGhEnvironment` 复用之；`api()` 不再走 `sync`，改为该环境下 `spawnSync` 的固定 Actions-scoped GET（endpoint 正则加尾锚、拒空白），`downloadArtifact` 的 zip `spawn('gh')` 也用该环境；`unzip`／build／codesign／upgrade 通用子进程仍零 TOKEN。**禁**把 `GH_TOKEN`／`GITHUB_TOKEN` 加进 `preservedHara` 全局白名单（会漏进 codesign 等所有子进程）。测试 `test/candidate-actions-gh-auth.test.mjs`：api／downloadArtifact 子进程 `credentialKeys=['GH_TOKEN']`，sync／run／`environment()` 子进程为空，失败消息不回显 token。教训：凡新增需认证的 `gh` 调用都必须走 `githubReadEnvironment`，不能经 `sync`/`run`；同 run rerun 带不上新 tip，须新 O＋proof＋kick。问题记录 SHA `071d9317…`，诊断 SHA `ab436985…`。

## live28 STALE_PROOF_TTL_RACE · admission proof expired before env approval · 2026-10-28

Hara 同事：live28 run `40550200133`＠O³² tip `d789c85e…` 的 `credential_preflight` 在 `readAdmission(waitForProof=false)` 报 `valid administrator proof missing/stale/policy-changed; no credential access`。根因：proof comment `6448747000` 绑定正确，但 TTL 01:24→03:24 Asia/Taipei，env 07:39 才批、preflight 07:41 时已过期；且该 comment 已在授权 `since` 窗外，旧文案把 missing／stale／policy-changed 捆在一起，易误导到 PEM／DevID。**同类复发**（live21 O²⁵ wiring TTL 同因）。修法（分支 `fix/orch-stale-proof-ttl-race-20261028`）：`verifyProof` 把新鲜度放到签名／绑定／policy 之后单独判定；`proofFromComments` 附带诊断；`readAdmission` 最终失败时仅为诊断做 24h 只读回看，输出 `administrator proof EXPIRED (TTL elapsed)` 含 issuedAt／expiresAt／now／overdue 与「re-publish／新 O 或 rerun；非 policy-changed、非 PEM／Keychain／updater-file／DevID」；policy-changed 与 missing 分开报。不加长 TTL、不放宽签名／绑定／policy、仍 fail-closed。教训：env 必须在 proof TTL 内批；超时重新 publish 或新 attempt，禁复用过期 comment、禁对 completed run 补签（见 `docs/CANDIDATE_GATE_A.md`「Proof lifetime and environment approval」）。问题记录 SHA `7a57a9d7…`，诊断 SHA `f918dcd5…`。

## R1 / O32 Core live27 Win EXDEV pin + Soft Dark SIDECAR · 2026-10-28

Hara 同事：live27 run `40532130904` 已于 O³¹ tip `6834a238…`／digest `1d3096ec…`（已消耗，禁复用）。根因 Win EXDEV（短 worktree rename 跨卷）。Core tip `29ecc4ac39f929aa627147461b2d1637f775abcb`（tree `6e348d4c…`；仅测改）已合入 `hara` main（PR #14／merge `091d8135…`），Jeff t842s4085 跳过 Elon 审。Soft Dark tip `9b4311a239360f30b10a1379e3fdbd3aacaa426f`（tree `2eeef453…`）经 PR #23 合入 main `6cde7267…`。本片从 O³¹ 建 O³² tip：candidate-inputs／candidate.yml 六处 App+Core／locks／orch SIDECAR 同步新钉，装绑全新 purpose，自检 MATCH 后踢 live28。禁复用 O³¹ digest `1d3096ec…`／O³⁰ `1e12be02…`／O²⁹ `1ca1bd84…`／补签 live27；禁正式 tag／PEM／force main；禁代批 env。Intel timeout 仍 HOLD。

## R1 / O31 Core live26 三刀 pin + Soft Dark SIDECAR · 2026-10-27

Hara 同事：live26 run `40506201909` 已于 O³⁰ tip `8362537587…`／digest `1e12be02…`（已消耗，禁复用）。Core tip `92b8983c8c8b6f0f32de0605bba14af2d8e13a5d`（tree `1bf230fd…`）已合入 `hara` main（PR #13／merge `f33be22…`），Elon PASS_WITH_NOTES（Intel=拆测＋可观测，Pi 根因未修）。Soft Dark tip `4f47f70fd4170964d0bef4978758bee38e3e2f3c`（tree `c5d218d4…`）经 PR #22 合入 main `7782c6b1…`（Jeff t822s4014 合推＋O³¹＋踢 live27）。本片从 O³⁰ 建 O³¹ tip：candidate-inputs／candidate.yml 六处 App+Core／locks／orch SIDECAR 同步新钉，装绑全新 purpose，自检 MATCH 后踢 live27。禁复用 O³⁰ digest `1e12be02…`／O²⁹ `1ca1bd84…`／O²⁸ `cfa8dbe7…`／补签 live25／live26；禁正式 tag／PEM／force main；禁代批 env。

## R1 / O30 Soft Dark candidate-inputs sync pin · 2026-10-27

Hara 同事：live25 run `40500125939` 已 completed/failure 于 O²⁹ tip `50a6db6f…`／digest `1ca1bd84…`（已消耗，禁复用）。根因是 Soft Dark `candidate-inputs.json` 仍钉旧 Core `b11009bd`（SIDECAR pin 未同步输入锁）。Soft Dark tip `18f9bc1259a4054d9f2c6c06cc767bfd112a8d51`（tree `baef7122…`）经 PR #21 合入 main `937e606a…`（Jeff t818s3963 跳过审）。本片从 O²⁹ 建 O³⁰ tip：desktop／workflow 六处 App／APPROVED_APP 重钉到 `18f9bc1`；core 保持 `282101fc`。自检 MATCH 后踢 live26。禁复用 O²⁹ digest `1ca1bd84…`／补签 live23／live25；禁正式 tag／PEM／force main。

## R1 / O29 Core private-socket pin + Soft Dark SIDECAR · 2026-10-27

Hara 同事：live24 run `40488820744` 已 completed/failure 于 O²⁸ tip `9bf9147c…`／digest `cfa8dbe7…`（已消耗，禁复用）。根因是 LegacyScopedCli common socket 路径超 100B；Core tip `282101fc7ea9fc6c7cf360f97859702df2c8a8c1`（tree `df751058…`）已合入 `hara` main（PR #12／merge `1f21e14`），Elon PASS_WITH_NOTES companion。Soft Dark `SIDECAR_COMMIT` 重钉到同一 Core（app tip `0731ae1416ffa3c506791d8f454ed850a5079873`／tree `b616740f…`，PR #20）。本片从 O²⁸ 建 O²⁹ tip：candidate-inputs／candidate.yml 六处 App+Core／locks／orch SIDECAR 同步新钉，装绑全新 purpose，请求／自检 MATCH 后踢 live25。禁复用 O²⁸ digest `cfa8dbe7…`／补签 live23／live24；禁正式 tag／PEM／force main；Host prepareCli wiring 仍 follow-up。


## R1 / O28 post-C2 fresh wiring preparation pointer · 2026-10-27

Hara 同事：live23 run `40476137051` 已 completed/failure 于 `credential_preflight` Unlock dedicated signing Keychain；admission 已过。根因是 `scripts/candidate-upgrade.mjs` 的 `gateEvidence.environment()` 在派 unlock 前 scrub 环境时，把路径引用 `HARA_CANDIDATE_SIGNING_KEYCHAIN` 与 `HARA_CANDIDATE_SIGNING_PASSWORD_FILE`（非口令明文）一并剥掉。C2 companion `ba3517bb977e2fe88f2c310ff7801f36e0167532` 已非 force 进入受控 ref，保留上述路径键并继续剥真实 PASSWORD／其它 SECRET／非白名单 `HARA_*`。旧 run 禁补签或重跑；合推完成不等于新 wiring 或 kick。

O²⁷ wiring tip `3b76be4e89defa6322b85f0fbdd86fad913c4763` 不能覆盖已推进的 C2 tip，旧 digest `967efaf8d578c240db74df0961ad126462f6aba441b1cd01cf1a1425719169da` 及 O²⁶ `1ca82ef8…`／更旧均禁复用。本片只从 C2 建本地 O²⁸ docs-only 子提交、装绑全新 purpose 并重新验闸，请求 Elon 只读 wiring 审查；请求／PASS 均不等于 kick live24。保持 Soft Dark、Core、INPUT_SHA、WORKFLOW_SHA 与 S2e 现有合同不变，不推 O²⁸、不代批 env、不碰钥匙串、`.p12`、PEM 或真实 `~/.hara`。

## live23 credential strip drops signing path env · 2026-10-27

Hara 同事：live23 run `40476137051` admission 已 success，随后 `credential_preflight` 在 Unlock dedicated signing Keychain 处以 exit=1 失败（0 artifact）。根因不是口令再漂或 partition：本机 rebuild A 后钥匙串／password 文件仍可解锁；`gateEvidence.environment()` 在 scrub 时因 `HARA_` 前缀与 `PASSWORD` 正则删掉了 `HARA_CANDIDATE_SIGNING_KEYCHAIN`／`HARA_CANDIDATE_SIGNING_PASSWORD_FILE`（二者值为路径，非口令明文），`candidate-unlock.swift` 读不到路径即 exit(1)。companion 修复：allowlist-first 保留上述两路径键，仍剥离任何真实口令／SECRET／其它 HARA_；单测与本机 `environment()`→unlock 冒烟 exit=0。禁补签 live23；本地绿≠正式 candidate；新 tip 须 O²⁸+ wiring，禁复用 O²⁷ digest `967efaf8…`／更旧。PASS≠kick live24；不碰 PEM／钥匙串／.p12／正式 tag。

## R1 / O27 post-C1 fresh wiring preparation pointer · 2026-10-27

Hara 同事：live22 run `40432601918` 已 completed/failure 于 `credential_preflight`，当时 synthetic HOME 下的用户钥匙串 metadata 查询先于 unlock 失败；随后 C1 companion `2de79f8584b65fa43d9614922e3e4598f51202dc` 已非 force 进入受控 ref，专用串口令失配亦经独立 rebuild A 与本机 S1–S5 冒烟恢复。旧 run 禁补签或重跑；本地钥匙串冒烟不等于正式 candidate 通过。

O²⁶ wiring tip `abbdbf512df898f28880d499e3afd7028524a7f2` 不能覆盖已推进的 C1 tip，旧 digest `1ca82ef8ab7aa0b53aaf7773914d4e5926f37e073f7658aaf91266d19a736397` 已过 TTL，连同 O²⁵ digest `38bdbc3d…` 及更旧均禁复用。本片只从 C1 建本地 O²⁷ docs-only 子提交、装绑全新 purpose 并重新验闸，请求 Elon 只读 wiring 审查；请求／PASS 均不等于 kick live23。保持 Soft Dark、Core、INPUT_SHA、WORKFLOW_SHA 与 S2e 现有合同不变，不推 O²⁷、不代批 env、不碰钥匙串、`.p12`、PEM 或真实 `~/.hara`。

## live22 synthetic HOME keychain metadata · 2026-10-27

Hara 同事：run `40432601918` 已在 admission 后、`credential_preflight` 的 `withSigning` → `metadata()` 处失败；`security list-keychains/default-keychain -d user` 从 evidence synthetic HOME 查询用户域，返回 exit 1，尚未进入 unlock。仅对两次只读 metadata 查询使用 `/usr/bin/env HOME=<realHome> /usr/bin/security … -d user`；`commandEvidence` 的 process/guard HOME 仍为 synthetic HOME，前后仍断言 metadata unchanged。不改 user search/default、不重建或解锁钥匙串；该 run 禁补签或重跑。companion 修复和无签名冒烟不等于新 wiring 审查或 live kick。

## R1 / O26 stale wiring preparation pointer · 2026-10-27

Hara 同事：live21 run `40363627829` 的 admission 通过，Jeff 于 05:37 Asia/Taipei 批准环境后，`credential_preflight` 在 `readAdmission` 报 `valid administrator proof missing/stale/policy-changed; no credential access`，正式构建、签名、DMG 与验证 job 均未开始。派单将根因钉为 O²⁵ wiring TTL 已于 02:18:33 Asia/Taipei 过期，环境审批发生在过期之后；旧 wiring digest `38bdbc3df500e5862ef2a6238d8e383d9b246fe8e2dbd2448f58f49bc3b8b8a8` 作废，不补签或重跑该 run。

O²⁶ 仅从 O²⁵ `e476053284c5f95e05f944ff8c363153a6bc8b06` 新建本地 docs-only 子提交，保留 Soft Dark Desktop、Core、inputs、workflow 与 S2e 已对齐的 INPUT/WORKFLOW SHA。O²⁵ 仅作本轮父提交，不作新 wiring tip；更旧 digest `87317348…` 亦禁复用。新 tip 与新 purpose 经本轮私有装绑及合同闸后只请求 Elon 审查；请求不等于 PASS，PASS 不等于 kick live22。

本片不 push O²⁶、不开 live22、不代批 env、不 publish，不碰 S2e 进程／CONTRACT／ENABLE、PEM、钥匙串、真实 `~/.hara`、正式 tag 或公证。

## R1 / O25 realHome preparation pointer · 2026-10-27

Hara 同事：live20 run `40349463643` 在 `credential_preflight` 失败。证据绑定将 `HOME` 指向 synthetic-home 后，`os.homedir()` 也返回合成目录，使 `realHome` 塌缩，updater key 探针误查 synthetic-home 下的 `.tauri`。B 修复 `0b8981e831cb8cfb123e054c4a1446914ee41a58` 把该值改为 `os.userInfo().homedir`；代码边界复审为 PASS，B 已另片非 force 推到受控 ref。本片不复制 `.tauri` 或密钥到合成目录。

O²⁵ 仅从 B tip 新建本地 docs-only 子提交，保留 Soft Dark Desktop、Core、candidate inputs 与 workflow 钉。旧 O²⁴ tip `4e98a14e8fed46daad5c373a054ffc45b3c30084`、digest `8731734846b82c944f704603c50292be414e99af7670112cf61211ddf5a75d1e` 均是死轨，禁止复用或补签 live20。B 推送副作用产生的 run `40354990109` 不等于获批的 live21，也不作为本片 kick 结案。

本片仅本地 tip、私有装绑和新鲜合同闸后请求 Elon exact wiring；请求不等于 PASS，PASS 不等于 kick。O²⁵ 不 push，不开 live21，不代批 env，不 publish，不碰 PEM、钥匙串、真实 `~/.hara` 或正式 tag。

## R1 / O24 Soft Dark preparation pointer · 2026-10-26

Hara 同事：live19 run `40299962765` 与 O²³ `1c1ca93d91afd65439bfa3f853175dedac13b3bc` 钉的是无 Soft Dark 的 Desktop `8c17541091f3febf8225b173743f49b7a3c75679`，不可作 1.1.0 Soft Dark 候选输入，禁止补签、重跑或续用旧 run。旧 wiring digest `80927e8099ccf2c48a7616548c2f41740f5142714d5afdd4b104cde0f38f8775` 及更旧不得复用。

本地 O²⁴ 唯一父为 O²³；Desktop pin 更新到 main `bf966f3ac463156c642dcd321594b96aa529c885`／tree `29e4b299837252cf15b3ea728f10c47d2944d52a`，版本 1.1.0。`candidate.yml` 的六处 App checkout ref 同步更新，避免 exact-O entry 将新 inputs 与旧 checkout 判为不一致；因此 WORKFLOW_SHA 将变化。S2e pid 66750 的旧 CONTRACT 必须另闸对齐后才能 kick，本片不触 S2e。

仅本地 tip、私有装绑和新鲜闸后请求 Elon exact wiring；请求不等于 PASS，PASS 不等于 kick。本片不 push、不开新 run、不 publish、不碰 PEM、钥匙串、真实 `~/.hara`、env 或正式 tag。

## R1 / O23 preparation pointer · 2026-10-26

Hara 同事：按派单3a92e6ad…与Jeff via Elon t2347s9111，仅建立新O²³ docs-only子提交；唯一父O²² 558263bed45eba38a55200e18db1d26517757cc2／tree 245b4df937cd8fa3a00cf099339ac1a4f9170f6b。
live18 run40293452339已completed/failure：Provision retained job evidence成功、actor/event/ref/workflow已过；黄窗≤240秒缺独立administrator proof。根因是S2e冻结CONTRACT.workflowSha256仍482aa91a…而磁盘workflow已aa027885…，导致api-or-ref且看不见新run；不是forbidden-prefix回归。复审SHA2f423ea93f1dd465b4fb706db1cc3b28df1ef9572c37576b927777afdd942d2b。
定案A S2e修复回执SHA4e4333c954ca053c7adff7e0521c29af200cea8d365553deb73e22358eacf6c9：耐久脚本CONTRACT重钉aa027885579ab40598828859ae1bd31aecfe221b6183cebceb6b31ebe2d9ff2a，pid66750。本片只读核近期JSONL api-or-ref=0，不修改或重启S2e、不触ENABLE/KEYDIR/PEM。
本片workflow/input/A/Core/锚/identity/wait240保持；严禁复用0863bcde…/c5c29d22…/88acb6f6…/1b449df4…及更旧digest、tip O²²或O²² purpose作新authority。永久禁补签/重跑40293452339、40279517278、40265916698、40262667750及更早。
仅本地tip+最小私有装绑+本轮实测闸→pendingElonReview；不push/live19/run/publish/env代批/PEM/钥匙串/真实~/.hara/正式tag/force。请求≠PASS，PASS≠kick；live19仍须新wiring与Jeff另明文。

## R1 / O22 preparation pointer · 2026-10-26

Hara 同事：按本地派单1d4ba4e0…与Jeff t691s3201定案A，纳入已审本地fix `6e202316deff7d4840f2d8fb0f25cb6b4733e741`，新WORKFLOW_SHA `aa027885579ab40598828859ae1bd31aecfe221b6183cebceb6b31ebe2d9ff2a`。
live17 run40279517278 admission成功，人证/S2e已通且环境闸已过；credential_preflight在Provision retained job evidence报forbidden evidence prefix：裸startsWith误伤真实runner兄弟目录`~/.hara-runners`。定案A仅修路径边界，真实`~/.hara`及其子目录、Caches、临时目录仍拒绝；不回退人证叙事或放宽waitSeconds=240。
authority父仅O21 `c9920c4ce74085c1eb5d886fc5360e267f74a859`／tree `3b12aa5e58600d8c0b5756e3bdba329a9e6a3c13`；保留fix提交后追加本pointer，完整实际Git父链另写请求。禁把O21作新tip，禁复用O21 purpose与digest c5c29d22…／88acb6f6…／1b449df4…及更旧。
永久禁补签/重跑40279517278、40265916698、40262667750及更早。本片仅本地tip+私有装绑+本轮实测闸→pendingElonReview；不push/live18/run/publish/PEM/钥匙串/真实~/.hara/S2e2909。INPUT/A/Core/公钥锚保持；请求≠PASS，PASS≠kick；live18另须新wiring与Jeff明文。

## R1 / O21 preparation pointer · 2026-10-26

Hara 同事：仅按本地派单 `2026-10-26-candidate-live-admission-admin-proof-p2-r1-o21-prepare-dispatch.md`
(SHA256 `708cd5a6c4bb38715e81a17f08a88368e79f160f9f7b41e8fda5ec6ddcd5898c`)
创建 O²¹ prepare；唯一父 O²⁰ ed68c40d8deef3ed51bbb186aa181205e5e40005。
live16 run40265916698已completed/failure；assertEvent及actor/event/ref/workflow已通过，240秒内PR #1没有有效独立管理员证明；步骤标题不是wrong actor拒因。复审45617b49…记S2e当时api-or-ref；S2e路径修复回执b0102706…已DONE（本片不修改合成树/hosts/ENABLE，不重启或卸载pid2909）。
永久禁补签/重跑40265916698、40262667750及更早；O²⁰仅作父，不复用旧tip/purpose或88acb6f6…及更旧digest作新authority。inputs、A/Core、公钥锚、workflow、admission、waitSeconds=240均保持。
本片仅本地tip+三文件装绑+新鲜闸→pendingElonReview，不push/live17/run/publish/PEM。未来新run须in_progress≤240s内真实publish并核PR #1，S2e已修不等于未来出证已成功；Jeff可用已核candidate-publish.sh后备，PASS≠kick，live17另须新exact wiring及Jeff明文。

## R1 / O20 preparation pointer · 2026-10-26

Hara 同事：仅按本地派单 `2026-10-26-candidate-live-admission-admin-proof-p2-r1-o20-prepare-dispatch.md`
(SHA256 `13e1f87d737d6720d09d407dd82979259ad0f5927ceff4a1d127d621ad617da8`)
创建 O²⁰ prepare；唯一父 O¹⁹ b3ea7c02b1ecbeaa576870331464c412d38bde18。
live15 run 40262667750 已 completed/failure；actor/event/ref/workflow 与 assertEvent 已通过，实际拒因为240秒内PR #1无有效独立签名administrator proof。S2e running 不等于真实publish成功；YAML步骤标题不是wrong actor/event/ref/workflow的拒因。诊断指针 `2026-10-26-candidate-live-admission-admin-proof-p2-r1-o19-live15-admission-elon-review.md` SHA256 `63e7837a102211f73b0d6a874c9036d016fe2c9854a3085692c794fa4fabe9ee`。
永久禁补签/重跑40262667750及十五旧跑；O¹⁹ wiring TTL已死，1b449df4…及更旧digest禁作O²⁰ authority。保持inputs、A/Core、公钥锚、workflow、admission与waitSeconds=240。
本片仅本地tip+装绑+闸→pendingElonReview，不push/live16/run/publish/PEM，不触S2e pid2909。未来publish须精确新run仍in_progress且≤240s，核实际PR #1证明；PASS≠kick，live16须全新exact wiring与Jeff另明文。

## R1 / O19 preparation pointer · 2026-10-26

Hara 同事：仅按本地派单
`2026-10-26-candidate-live-admission-admin-proof-p2-r1-o19-prepare-dispatch.md`
(SHA256 `745858b17b79bf0085e588eb2bd832c8ab43969a24ed360a0ffeef849e9ee7ca`)
创建 O¹⁹ prepare；唯一父 O¹⁸ d2b314bb3002abdc19242f345b06ca0631bd4e62。
live14 终稿 SHA 398027f2483576a9a3d0a64e340e0d70f30db7bc426a7af2f73bb90c4ec5e132：blockedAt=approval，AUTO_REVIEW_REJECTED_CONTROLLED_REF_PUSH_AND_NEW_CI_RUN；pushedRef=false、newRunId=null、executeProcessStarted=false。它没有人证窗超时或 wrong actor/event/ref/workflow；推送与原待确认请求现已作废，禁止 resume/补签/重推。O¹⁸ wiring TTL 已过，583fd654… 及更旧 digest 禁复用。
仅本地 tip+装绑+新鲜绿闸→pendingElonReview；不改 inputs、锚、A/Core、workflow 或 admission/waitSeconds=240；不 push/live15/publish/PEM，不触 S2e attestor。未来 live15 须另闸全新 Elon PASS、本机 MATCH 及 Jeff 明文点头。

## R1 / O18 preparation pointer · 2026-10-25

Hara 同事：O¹⁸ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o18-prepare-dispatch.md`
(SHA256 `3ca87462545915dda176562d8272b23f3e7d8766efdd03d99c1b98fbc260ebd3`).
Sole parent: O¹⁷ 399d32d8ec2b05dcd493439c8f3fe89135785545. The prior live13 receipt fde6032f6000c1970a954d7df93f2f0e86c9c556ef31fb9db881b341aa27bb0b is retained at its recorded handoff time. This dispatch provides the later observation that run 40203780756 completed/failure after the independent human-proof window timed out, according to this dispatch; no private context inspection, late proof or rerun.
Keep input/public anchor, admission human-proof gate and waitSeconds=240 unchanged. Future Jeff-only publish must occur while the exact new run remains in_progress within the existing window. Live14 needs fresh exact wiring PASS, local MATCH and a separate dispatch.

## R1 / O17 preparation pointer · 2026-10-25

Hara 同事：O¹⁷ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o17-prepare-dispatch.md`
(SHA256 `f80d876f443e23f9b61c100f5e1fab5c685e6d04575ad7e0d2aaa667888903d1`).
Sole parent: O¹⁶ 468dfa9f87354b56a636864192ed2ed14375de49. The prior live12 receipt 19ed4aaec88e95d39364f78c4275f59bd43df3a745871ea8d1191ce22c7bc031 is retained at its recorded handoff time. This dispatch provides the later observation that run 40201432830 completed/failure after the independent human-proof window timed out and local administrator attestation failed, according to this dispatch; no private context inspection, late proof or rerun.
Keep input/public anchor, admission human-proof gate and waitSeconds=240 unchanged. Future Jeff-only publish must occur while the exact new run remains in_progress within the existing window. Live13 needs fresh exact wiring PASS, local MATCH and a separate dispatch.

## R1 / O16 preparation pointer · 2026-10-25

Hara 同事：O¹⁶ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o16-prepare-dispatch.md`
(SHA256 `9de52a0ecd4e5809884e4e5323897549850d6212925981c3c9f506c38166dc5a`).
Sole parent: O¹⁵ afc27da27ace5a312c54d364a883a5dc09c3d022. The prior live11 receipt 6a83559cb90a62f539da7507534d166581a2eb77565909b0e175a75ede4ef231 is retained at its recorded handoff time. This dispatch provides the later observation that run 40199330628 completed/failure after the independent human-proof window timed out; no late proof or rerun.
Keep input/public anchor, admission human-proof gate and waitSeconds=240 unchanged. Future Jeff-only publish must occur while the exact new run remains in_progress within the existing window. Live12 needs fresh exact wiring PASS, local MATCH and a separate dispatch.

## R1 / O15 preparation pointer · 2026-10-25

Hara 同事：O¹⁵ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o15-prepare-dispatch.md`
(SHA256 `6847d3cca567fd9877520f10b36bd7264ea2a5902eea3eb821a03063c01f12b3`).
Sole parent: O¹⁴ 9d8408db165726b4d8a4c47c89f79a98e865d3ad. The prior live10 receipt b9a9f234b18adaa52773861bf83cb9b345cd9fa40e675d22f73a061b7db7967b is retained at its recorded handoff time. This dispatch provides the later observation that run 40197343779 completed/failure after the independent human-proof window timed out; no late proof or rerun.
Keep input/public anchor, admission human-proof gate and waitSeconds=240 unchanged. Future Jeff-only publish must occur while the exact new run remains in_progress within the existing window. Live11 needs fresh exact wiring PASS, local MATCH and a separate dispatch.

## R1 / O14 preparation pointer · 2026-10-25

Hara 同事：O¹⁴ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o14-prepare-dispatch.md`
(SHA256 `f709e5d0b5916bb47deb7055a5cd994c7de43fea11a10db9bf218a57797bcdd5`).
Sole parent: O¹³ 46c89f3cfe72076ec4b4d8833f55a6d7b47eda05. Live9 final receipt 620e5d851eb89162b7e9460293cf9fd2bc5d991238f346347bdc127b2e455db0 records run 40194716398 completed/failure; the dispatch attributes it to the independent human-proof window timeout. No late proof or rerun.
Keep input/public anchor, the admission human-proof gate and waitSeconds=240 unchanged. Future Jeff-only publish must occur while the exact new run remains in_progress within the existing window. Live10 needs fresh exact wiring PASS, a local MATCH check and a separate dispatch.

## R1 / O13 preparation pointer · 2026-10-25

Hara 同事：O¹³ preparation follows revised local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o13-prepare-dispatch.md`
(SHA256 `c0232f9585a86908690bf5c835110af8d6c8db107c239ca1f65ae7550cdca3db`).
The revised prerequisite pins the final live8 receipt. The dispatch records run 40189978881 as completed/failure after the independent admin-proof window; no late proof or rerun.
Retain input/public anchor, the admission human-proof gate and waitSeconds=240. Future Jeff-only publish must occur while the exact new run remains in_progress. Live9 requires fresh exact wiring PASS and a local MATCH check under a separate dispatch.

## R1 / O12 preparation pointer · 2026-10-25

Hara 同事：O¹² preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o12-prepare-dispatch.md`
(SHA256 `14d863a63ccba7fbb1a5bd6b87428d12c97dd8eafa8df9c1214578ce95a259a3`).
The dispatch records preceding live7 run 40187061590 as completed/failure at admission; no late proof or rerun.
Retain input/public anchor, the admission human-proof gate and waitSeconds=240. Future Jeff-only publish must occur while the exact new run remains in_progress. Live8 requires fresh exact wiring PASS and a local MATCH check under a separate dispatch.

## R1 / O11 preparation pointer · 2026-10-25

Hara 同事：O¹¹ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o11-prepare-dispatch.md`
(SHA256 `9e63a5f6b6161d98e69451faa0704639891a459a91bedb2c5b4905e66f530efb`).
The dispatch records preceding live6 run 40184726876 as completed/failure after the independent admin-proof wait; no late proof or rerun.
Retain input/public anchor, the admission human-proof gate and waitSeconds=240. Future Jeff-only publish must occur while the exact new run remains in_progress. Live7 requires fresh exact wiring PASS and Jeff explicit screen-ready under a separate dispatch.

## R1 / O10 preparation pointer · 2026-10-25

Hara 同事：O¹⁰ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o10-prepare-dispatch.md`
(SHA256 `70b1f259afa3c9dd89c3dd6c2419918f134e5e19aa34a270c6b6bb5f97ac6fd9`).
The dispatch records preceding live5 run 40180770823 as completed/failure after the independent admin-proof wait; no late proof or rerun.
Retain input/public anchor, the admission human-proof gate and waitSeconds=240. Live6 requires fresh exact wiring PASS and Jeff explicit screen-ready under a separate dispatch.

## R1 / O9 preparation pointer · 2026-10-25

Hara 同事：O⁹ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o9-prepare-dispatch.md`
(SHA256 `a12541a45fac8fde51e3350bef36251ad113276f4b88aa38f2a2394c34e58891`).
The dispatch records preceding live4 run 40177159247 as completed/failure after the independent admin-proof wait; no late proof or rerun.
Retain input/public anchor and waitSeconds=240. Live5 requires new exact wiring PASS and fresh Jeff explicit screen-ready, in a separately authorized slice.

## R1 / J2 readiness pointer · 2026-10-25

Hara 同事：R1/J2 readiness is recorded in local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o6-live-dispatch.md`
(SHA256 `1d5be03519b5a1aa619c2e52bfab76487ffd956f54905b1cae157887ab3982ef`).
The dispatch records Jeff J0–J4 ready, including J2 under the evidence-bound environment.
Fresh exact-source wiring is still required; keep the 240-second proof window and Jeff-only publish.

## R1 / O7 preparation pointer · 2026-10-25

Hara 同事：O⁷ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o7-prepare-dispatch.md`
(SHA256 `ed9095b000d985f590d310443a2c7b368f467f16d06acdd28c958536b7e6f353`).
The dispatch records preceding live2 run 40167717447 as completed/failure; no late proof or rerun.
Keep the existing input, public anchor and 240-second window; fresh wiring review precedes live3.

## R1 / O8 preparation pointer · 2026-10-25

Hara 同事：O⁸ preparation follows local dispatch
`2026-10-25-candidate-live-admission-admin-proof-p2-r1-o8-prepare-dispatch.md`
(SHA256 `f8b68acd289b3a6a5b2cc8fe1e0ca63a4c8563b04b32705d340b29d7b51ae274`).
The dispatch records preceding live3 run 40171798323 as completed/failure; no late proof or rerun.
Retain input/public anchor and waitSeconds=240. Live4 needs new wiring PASS and fresh Jeff ready.
