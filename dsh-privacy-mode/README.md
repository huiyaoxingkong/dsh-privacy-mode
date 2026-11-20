# dsh-privacy-mode

两个方向不对称的可见性模式，给 DeepSeek Harness 用：

- **NORMAL**：被标记为隐私的 **插件 / 工作区 / 会话** 在这个 profile 里**不存在**——不是"禁用"，
  是 tool catalog 里没有、system prompt 里没有、侧栏里没有。
- **PRIVATE**：整个 profile 重新可见，NORMAL 的一切照旧可用，另外多一个管理与审计入口。

会话只**归档**、不删除；切回 NORMAL 时精确还原被隐藏的那几条。任何一步失败都回滚到切换前。

## 要求

- DeepSeek Harness `>=0.2.2-rc.5 <0.3.0`，profile 为 `desktop`（Windows / macOS / Linux）。
- 依赖 DSH 自带服务：`pluginManager`、`webServer`、`workspaceRegistry`（缺一个就不激活）。

## 安装

```bash
# 在 DSH 的插件管理里安装本地目录（会做 pnpm link，不复制文件）
plugin_manager install_bundle {"target": "D:/path/to/dsh-privacy-mode"}
plugin_manager set_bundle    {"target": "dsh-privacy-mode", "enabled": true}
```

首次 `install_bundle` 可能因 pnpm 供应链策略失败一次，日志形如：

```
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:
  dsh-console-hm@0.5.90 was published ... within the minimumReleaseAge cutoff
```

那是 profile 里**别的**包太新被策略拦下，与本插件无关；重试一次即可（pnpm 已把该包写进
`minimumReleaseAgeExclude`）。第二次应当返回 `application: applied`。

启用/停用本插件会触发 profile 重组（见下面的"已知限制"）。

## 使用

界面文案中文优先（跟随 DSH 语言设置：`zh*` 显示中文，`en*` 显示英文，其它语言回落中文）。

| 界面 | 位置 | 作用 |
|---|---|---|
| 模式按钮 | 输入框左侧工具行、模型选择器之前 | NORMAL 下是描边图标，点一下要求解锁；PRIVATE 下按钮**点亮**，再点一下直接退出 |
| 隐私模式设置 | 点亮后出现在模式按钮**旁边**，只在 PRIVATE 渲染 | 标记插件、工作区、会话；设置密码；登记/移除指纹；看审计日志 |
| 侧栏盾牌 | 侧栏底部 | 常驻入口：NORMAL 下打开显示"进入隐私模式"，PRIVATE 下打开就是设置面板 |
| 设置页 | 设置 → 隐私模式 | 常驻；NORMAL 下只有进入按钮与说明，PRIVATE 下是完整可分页面 |
| 审计日志 | `~/.dsh/privacy-mode/audit.log` | 切换/标记/PIN/指纹/恢复各一行 JSON，本地、有上限轮转 |

三个入口里任意一个都能进：输入框旁的 chip、侧栏底部盾牌、设置页。分类**只在 PRIVATE 可改**——
NORMAL 下这三处都不列出插件/工作区/会话，服务端对 `/mark` 直接返回 `settings-locked`。
分类选项按类型命名：插件是「隐私插件 / 常规插件」，工作区与会话同理。

### 解锁方式

1. **密码（PIN）**：4 位以上，scrypt + 每 PIN 盐，磁盘上没有明文。首次进入隐私模式时设置，需要输两次。
2. **指纹 / 安全密钥（可选）**：登记后进入隐私模式可以用 Windows Hello / Touch ID 解锁，不必输密码。
   指纹本身不出浏览器：Host 只保存**公钥**和 credential id，每次解锁由 `lib/webauthn.js` 校验签名
   （challenge 一次性、origin 绑定、rpIdHash、UP/UV 标志、ECDSA 签名全部检查）。
   需要 `http://localhost:<端口>` 打开页面——**IP 地址不能当 WebAuthn 来源**，用 `127.0.0.1` 时按钮会隐藏并提示。
3. **忘记密码**：密码框下方有"忘记密码？"。走的是**电脑 PIN**——`navigator.credentials` 会调用系统验证，
   Windows Hello 允许输入 PC PIN 或按指纹；验证通过后 Host 发一枚 5 分钟内有效、只能用一次的令牌，
   用它重设密码并进入隐私模式。没登记过凭证时会先登记一个，那一步同样要走 Hello。
   `Authenticator` 之类的跨设备验证器留作后续：现在的约束是"必须在这台电脑上"。

### 安装即分类

安装发生的模式决定新 bundle 的归属：**PRIVATE 下装的默认是隐私插件**（回到 NORMAL 会被卸载），
**NORMAL 下装的默认是常规插件**。安装那一刻不动任何 bundle，只记录分类，下一次切换才生效。

状态文件：`~/.dsh/privacy-mode/state.json`（`$DSH_HOME` 存在时取它）。

## 已知限制（重要）

1. **切换会重组 profile。** NORMAL 的"不存在"是通过 `pluginManager.setBundleEnabled` 取消选择
   bundle 实现的，而这一步会让 Loader 停掉/重建运行中的插件行，**正在跑的 agent 会被 dispose**。
   因此：
   - HTTP 路由**先回 202**，切换在队列里跑，浏览器轮询拿结果；
   - 带 `sessionId` 的切换会先等该会话的回合结束（最多 4 s）再动手；
   - 若你从**一个正在跑的会话**里点 chip，那个回合仍可能被中断——这是隔离机制的代价，不是 bug。
     设计上：模式只对**尚未开始**的会话即时生效；已开始的会话走一次性临时会话。
2. **一次只跑一个切换。** 第二个请求会得到 `busy: true`（HTTP 409），不会排队两次。
3. **`listBundles()` 很贵**（这个 profile 上冷调约 8 s、热调约 1.2 s）。轮询走缓存，冷启动后第一次
   管理页可能先看到空列表，1–2 秒后补齐。
4. **管理页首次读取会话标题也慢**（一次一页 25 个，每个 3–5 s，之后 60 s 内走缓存）。列表先用 id
   占位，标题随轮询补齐；不想等就点"刷新"。
5. 只改可见性与挂载，不加密、不迁移 `~/.dsh/sessions` 与工作区注册表。关掉插件即完全恢复原状。
6. **指纹只在 `localhost` 有效**：以 `127.0.0.1` 打开时浏览器拒绝把 IP 当 relying party，插件会隐藏该按钮并给出提示；用密码解锁不受影响。

## 卸载 / 回滚

```bash
plugin_manager set_bundle    {"target": "dsh-privacy-mode", "enabled": false}
plugin_manager remove_bundle {"target": "dsh-privacy-mode"}
```

停用后：三个插件行（host + 两个 preset）一起消失，路由 404，被它标记的 bundle 会在下一次
NORMAL 重组里回到启用状态；归档记录留在 `state.json`，删掉该目录即彻底清空。

## 开发

```bash
node scripts/selfcheck-coldstart.mjs   # 58 项：模式语义、回滚、PIN 两次确认、指纹登记/校验、找回令牌、安装分类、队列与假死、异步契约
node scripts/check-client.mjs          # 无浏览器渲染检查：NORMAL/PRIVATE 两种状态下每个入口渲染什么文字
node scripts/check-presets.mjs         # 两个 preset 的工具行与已装 standard preset 比对（漂移检查）
```

`selfcheck` 用真引擎 + 假服务，在临时目录里跑，不碰真实 profile；`check-presets` 需要
`--standard PATH` 或 `DSH_INSTALL_DIR` 指向 DSH 安装根，找不到时 SKIP 而不是失败。
