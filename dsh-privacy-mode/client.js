/**
 * Browser half of the privacy bundle.
 *
 * Three surfaces, one shared state store:
 *  - a mode button at the left of the composer tool row, immediately before the model
 *    selector (`conversation.input.left`): outlined in NORMAL, lit in PRIVATE, and a
 *    second click leaves PRIVATE without asking for anything;
 *  - a settings button beside it, rendered only while PRIVATE (`conversation.input.left`,
 *    order 21) — the classification page is a private surface;
 *  - the same management view as a settings page (`settings.section`), also PRIVATE-only.
 *
 * The Host half owns every decision. This half shows state, sends intent, and
 * applies one visual layer: in NORMAL mode a stylesheet suppresses the rows DSH
 * has no filter hook for. That layer is additive and disappears with the plugin.
 */
window.__ModuleLoader__.load({
  id: 'dsh-privacy-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'privacyMode'
    const ROUTE = '/.dsh-privacy-mode'
    const POLL_MS = 5000
    /** While a switch job runs the poll tightens up: the toggle takes seconds. */
    const FAST_POLL_MS = 1200

    const DICT = {
      'zh-CN': {
        modeName: { normal: '正常', private: '隐私' },
        chipTitle: '切换可见性模式',
        open: '隐私模式设置',
        openHint: '标记隐私插件、工作区与会话',
        title: '隐私模式',
        modeSection: '模式',
        currentMode: '当前模式',
        enterPrivate: '进入隐私模式',
        leavePrivate: '回到正常模式',
        switching: '切换中…',
        pinSection: 'PIN',
        pinSet: '已设置 PIN，进入隐私模式时需要输入。',
        pinUnset: '未设置 PIN。任何能操作此界面的人都可以进入隐私模式。',
        pinNew: '新 PIN',
        pinCurrent: '当前 PIN',
        pinSave: '保存 PIN',
        pinClear: '移除 PIN',
        pinSaved: 'PIN 已保存。',
        pinCleared: 'PIN 已移除。',
        pinTooShort: '至少 4 个字符。',
        pinMismatch: 'PIN 不匹配。',
        pinLabel: 'PIN',
        pinPlaceholder: '输入 PIN',
        confirm: '确认',
        cancel: '取消',
        close: '关闭',
        bundles: '隐私插件',
        bundlesHint: '选「隐私插件」：常规模式下该 bundle 取消选择，行、工具、提示词都不装载；选「常规插件」：两种模式都可用。',
        workspaces: '隐私工作区',
        workspacesHint: '被标记的工作区行在正常模式下不渲染；其会话被归档，不会散落到未分组列表。',
        sessions: '隐私会话',
        sessionsHint: '被标记的会话在正常模式下被归档，不出现在会话列表。',
        unclassified: '未归类',
        unclassifiedHint: '这些项目还没有决定去向，检查一下避免漏配。',
        empty: '没有可列出的项。',
        count: '共 {n} 项',
        classification: '分类',
        clsPrivate: '隐私',
        clsPublic: '公开',
        clsNone: '未归类',
        clsBundlePrivate: '隐私插件',
        clsBundlePublic: '常规插件',
        clsWorkspacePrivate: '隐私工作区',
        clsWorkspacePublic: '常规工作区',
        clsSessionPrivate: '隐私会话',
        clsSessionPublic: '常规会话',
        bulkPrivate: '全部设为隐私',
        bulkPublic: '全部设为常规',
        bulkNone: '全部未归类',
        bulkApplied: '已批量应用 {n} 项。',
        waitingIdle: '等待当前回合结束…',
        privateGroup: '隐私工作区',
        normalGroup: '常规工作区',
        badgePrivate: '隐私',
        busySwitching: '正在应用更改…',
        restoreNative: '还原原生工作区列表',
        moreSessions: '还有 {n} 个会话未显示',
        expand: '展开',
        collapse: '收起',
        convPrivate: '隐私对话',
        convNormal: '常规对话',
        convHint: '只影响本对话：标记后只在隐私模式可见，并随隐私模式一起归档/还原。',
        convNoSession: '这个对话还没有会话 id，发送第一条消息后再标记。',
        frostHint: '本对话已标记为隐私对话，内容已磨砂遮挡。',
        frostWorkspaceHint: '当前对话属于隐私工作区：常规模式下不显示内容，进入隐私模式可查看。',
        frostOff: '恢复显示',
        frostEnter: '进入隐私模式',
        hiddenChats: '已隐藏的对话',
        allHidden: '全部 {n} 个对话都是隐私对话，见下方「已隐藏的对话」。',
        enabled: '已装载',
        disabled: '未装载',
        sessionsCount: '{n} 个会话',
        archived: '已归档',
        audit: '审计日志',
        auditHint: '本地文件，最新在前。',
        auditPath: '文件',
        auditEmpty: '还没有记录。',
        refresh: '刷新',
        loading: '加载中…',
        error: '无法读取隐私状态：{why}',
        failed: '切换失败，已回滚：{why}',
        switchedTo: '已切换到{mode}模式。',
        hintStarted: '当前会话已开始，模式只影响之后新建的会话与该 profile 的插件装载。',
        newSessionCreated: '已新建一次性会话，用它继续当前模式的工作。',
        pinSetupTitle: '设置解锁密码',
        pinSetupHint: '第一次进入隐私模式，先设一个密码。要输两次；也可以改用本机指纹或安全密钥。',
        pinConfirm: '再输一次',
        pinConfirmMismatch: '两次输入的密码不一致。',
        pinSetupDone: '密码已设置。',
        credentialSection: '指纹 / 安全密钥',
        credentialSet: '已登记。进入隐私模式可以用系统指纹（Windows Hello / Touch ID）解锁。',
        credentialUnset: '未登记。登记后可用系统指纹或安全密钥解锁，不必每次输密码。',
        credentialAdd: '登记指纹 / 安全密钥',
        credentialRemove: '移除',
        credentialAdded: '已登记。',
        credentialRemoved: '已移除。',
        credentialUnavailableIp: '指纹/安全密钥只在 localhost 或 HTTPS 下可用，当前地址是 {host}。改用 http://localhost:<端口> 打开本页即可；密码解锁不受影响。',
        credentialUnavailableApi: '这个浏览器没有提供指纹接口（PublicKeyCredential），只能用密码。',
        credentialCancelled: '已取消系统验证。',
        credentialFailed: '指纹操作失败：{why}',
        unlockWithCredential: '用指纹解锁',
        setupRequired: '先设置密码或登记指纹，再进入隐私模式。',
        forgotPassword: '忘记密码？',
        recoverTitle: '用电脑 PIN 找回',
        recoverHint: '这一步调用系统验证（Windows Hello：电脑 PIN 或指纹）确认是你，然后让你重设密码。还没登记过指纹 / 安全密钥时，会先登记一个，同样需要 Hello 验证。',
        recoverAction: '验证并重设密码',
        recoverUnsupported: '当前地址不能用系统验证：请用 http://localhost:端口 打开本页，否则只能手动清空 ~/.dsh/privacy-mode/state.json 里的密码。',
        resetTitle: '设置新密码',
        recoverDone: '已验证，请设置新密码。',
        settingsChip: '隐私模式设置',
        settingsLocked: '隐私模式设置只在隐私模式下可用。退出隐私模式后这里会自动收起。'
      },
      'en-US': {
        modeName: { normal: 'Normal', private: 'Private' },
        chipTitle: 'Switch visibility mode',
        open: 'Privacy mode settings',
        openHint: 'Mark plugins, workspaces and sessions as private',
        title: 'Privacy mode',
        modeSection: 'Mode',
        currentMode: 'Current mode',
        enterPrivate: 'Enter private mode',
        leavePrivate: 'Return to normal mode',
        switching: 'Switching…',
        pinSection: 'PIN',
        pinSet: 'A PIN is set. Entering private mode asks for it.',
        pinUnset: 'No PIN is set. Anyone at this screen can enter private mode.',
        pinNew: 'New PIN',
        pinCurrent: 'Current PIN',
        pinSave: 'Save PIN',
        pinClear: 'Remove PIN',
        pinSaved: 'PIN saved.',
        pinCleared: 'PIN removed.',
        pinTooShort: 'Use at least 4 characters.',
        pinMismatch: 'That PIN does not match.',
        pinLabel: 'PIN',
        pinPlaceholder: 'Enter the PIN',
        confirm: 'Confirm',
        cancel: 'Cancel',
        close: 'Close',
        bundles: 'Private plugins',
        bundlesHint: 'Private plugin: the bundle is deselected in normal mode — rows, tools and prompt text never load. Regular plugin: available in both modes.',
        workspaces: 'Private workspaces',
        workspacesHint: 'A marked workspace row is not rendered in normal mode, and its sessions are archived rather than falling into the ungrouped list.',
        sessions: 'Private sessions',
        sessionsHint: 'A marked session is archived in normal mode and stays out of the session list.',
        unclassified: 'Not classified',
        unclassifiedHint: 'These items have no decision yet. Review them so nothing leaks.',
        empty: 'Nothing to list.',
        count: '{n} items',
        classification: 'Class',
        clsPrivate: 'Private',
        clsPublic: 'Public',
        clsNone: 'Unclassified',
        clsBundlePrivate: 'Private plugin',
        clsBundlePublic: 'Regular plugin',
        clsWorkspacePrivate: 'Private workspace',
        clsWorkspacePublic: 'Regular workspace',
        clsSessionPrivate: 'Private session',
        clsSessionPublic: 'Regular session',
        bulkPrivate: 'All private',
        bulkPublic: 'All regular',
        bulkNone: 'All unclassified',
        bulkApplied: 'Applied {n} items.',
        waitingIdle: 'Waiting for this turn to finish…',
        privateGroup: 'Private workspaces',
        normalGroup: 'Regular workspaces',
        badgePrivate: 'Private',
        busySwitching: 'Applying changes…',
        restoreNative: 'Restore the built-in workspace list',
        moreSessions: '{n} more sessions not shown',
        expand: 'Expand',
        collapse: 'Collapse',
        convPrivate: 'Private chat',
        convNormal: 'Regular chat',
        convHint: 'Affects this conversation only: a marked chat shows in private mode alone and is archived and restored with it.',
        convNoSession: 'This conversation has no session id yet; send one message first.',
        frostHint: 'This conversation is marked private; its content is frosted.',
        frostWorkspaceHint: 'This conversation belongs to a private workspace: its content stays covered in normal mode. Enter private mode to read it.',
        frostOff: 'Show it again',
        frostEnter: 'Enter private mode',
        hiddenChats: 'Hidden chats',
        allHidden: 'All {n} chats here are private; find them under "Hidden chats" below.',
        enabled: 'Loaded',
        disabled: 'Not loaded',
        sessionsCount: '{n} sessions',
        archived: 'Archived',
        audit: 'Audit log',
        auditHint: 'Local file, newest first.',
        auditPath: 'File',
        auditEmpty: 'No entries yet.',
        refresh: 'Refresh',
        loading: 'Loading…',
        error: 'Could not read the privacy state: {why}',
        failed: 'The switch failed and was rolled back: {why}',
        switchedTo: 'Now in {mode} mode.',
        hintStarted: 'This session has already started. The mode affects sessions you start next and how plugins load in this profile.',
        newSessionCreated: 'A one-shot session was created; continue there.',
        pinSetupTitle: 'Set an unlock password',
        pinSetupHint: 'First time in private mode: choose a password. Enter it twice, or use this computer’s fingerprint or security key instead.',
        pinConfirm: 'Repeat it',
        pinConfirmMismatch: 'The two entries do not match.',
        pinSetupDone: 'Password set.',
        credentialSection: 'Fingerprint / security key',
        credentialSet: 'Registered. Entering private mode can use Windows Hello or Touch ID.',
        credentialUnset: 'Not registered. Register one to unlock with the system fingerprint instead of typing a password.',
        credentialAdd: 'Register fingerprint / security key',
        credentialRemove: 'Remove',
        credentialAdded: 'Registered.',
        credentialRemoved: 'Removed.',
        credentialUnavailableIp: 'Fingerprint and security keys work only on localhost or HTTPS; this page is {host}. Open http://localhost:PORT instead — the password keeps working either way.',
        credentialUnavailableApi: 'This browser exposes no fingerprint API (PublicKeyCredential), so only the password is available.',
        credentialCancelled: 'The system check was cancelled.',
        credentialFailed: 'The fingerprint step failed: {why}',
        unlockWithCredential: 'Unlock with fingerprint',
        setupRequired: 'Set a password or register a fingerprint before entering private mode.',
        forgotPassword: 'Forgot the password?',
        recoverTitle: 'Recover with the computer PIN',
        recoverHint: 'This asks the system (Windows Hello: PC PIN or fingerprint) to confirm it is you, then lets you set a new password. If no fingerprint or security key is registered yet, one is registered first — the same Hello check.',
        recoverAction: 'Verify and set a new password',
        recoverUnsupported: 'This address cannot use system verification: open the page as http://localhost:PORT. Otherwise the only way out is deleting the PIN in ~/.dsh/privacy-mode/state.json.',
        resetTitle: 'Set a new password',
        recoverDone: 'Verified. Choose a new password.',
        settingsChip: 'Privacy settings',
        settingsLocked: 'Privacy settings are available in private mode only; they fold away when you leave it.'
      }
    }

    const CSS = `
.dsh-privacy { color: var(--dsw-alias-label-primary); font: inherit; }
.dsh-privacy-chip { box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 9px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; white-space: nowrap; }
.dsh-privacy-chip:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-privacy-chip:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-privacy-chip[data-mode='private'] { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground); box-shadow: 0 0 0 3px rgba(47,111,235,.18); }
.dsh-privacy-chip[data-mode='private']:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.06); }
.dsh-privacy-chip-settings { border-style: dashed; color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-privacy-chip:disabled { opacity: .5; cursor: default; }
.dsh-privacy-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dsh-privacy-icon-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-privacy-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-privacy-scrim { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.35); }
.dsh-privacy-dialog { box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; width: min(720px, 100%); max-height: min(82vh, 900px); overflow: hidden; padding: 20px 22px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l2); box-shadow: var(--dsw-shadow-overlay, 0 18px 48px rgba(0,0,0,.28)); }
.dsh-privacy-dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dsh-privacy-dialog-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.dsh-privacy-dialog-body { display: flex; flex-direction: column; gap: 22px; overflow: auto; padding-right: 2px; }
.dsh-privacy-section { display: flex; flex-direction: column; gap: 6px; }
.dsh-privacy-section-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dsh-privacy-section-title { font-size: 12px; font-weight: 600; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dsh-privacy-hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.dsh-privacy-card { display: flex; flex-direction: column; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); }
.dsh-privacy-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; }
.dsh-privacy-row + .dsh-privacy-row { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-privacy-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-privacy-row-title { font-size: 13px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-privacy-row-sub { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-privacy-select { box-sizing: border-box; height: 26px; padding: 0 6px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.dsh-privacy-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 28px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-privacy-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-privacy-button:disabled { opacity: .45; cursor: default; }
.dsh-privacy-primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-foreground); }
.dsh-privacy-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsh-privacy-input { box-sizing: border-box; height: 30px; padding: 0 9px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.dsh-privacy-input:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.dsh-privacy-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-privacy-note { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dsh-privacy-error { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }
.dsh-privacy-audit { margin: 0; padding: 10px 12px; max-height: 220px; overflow: auto; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-radius: var(--dsw-radius-lg); }
.dsh-privacy-pill { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); }
.dsh-privacy-pill[data-tone='private'] { color: var(--dsw-alias-brand-primary); }
.dsh-privacy-noscript { display: none; }

/* Regrouped workspace list (PRIVATE only) */
.dsh-privacy-groups { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; }
.dsh-privacy-group-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; letter-spacing: .03em; cursor: pointer; }
.dsh-privacy-group-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-privacy-group-head[data-tone='private'] { color: var(--dsw-alias-brand-primary); }
.dsh-privacy-group-count { margin-left: auto; font-size: 10px; opacity: .8; }
.dsh-privacy-caret { display: inline-block; width: 10px; transition: transform .15s ease; }
.dsh-privacy-caret[data-collapsed='true'] { transform: rotate(-90deg); }
.dsh-privacy-ws { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 10px 5px 20px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.dsh-privacy-ws:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-privacy-ws-row { padding: 2px 10px 2px 6px; cursor: default; }
.dsh-privacy-ws-row:hover { background: transparent; }
.dsh-privacy-caret-btn { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; cursor: pointer; }
.dsh-privacy-caret-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-privacy-ws-main { flex: 1; min-width: 0; padding: 3px 4px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dsh-privacy-ws-main:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-privacy-groups-foot { padding: 6px 10px 2px; }
.dsh-privacy-ws-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-privacy-session { padding-left: 34px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-privacy-session:hover { color: var(--dsw-alias-label-primary); }
.dsh-privacy-badge { margin-left: auto; padding: 0 5px; border-radius: 999px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground); font-size: 10px; }
.dsh-privacy-empty { padding: 4px 12px 6px 34px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }

/* Switch transition: the profile recomposes in the background, so the click needs an
   immediate answer that survives a two-second wait. */
/* Switch feedback: a corner toast, never a full-screen block. The switch recomposes
   the profile in the background and the page must stay usable while it does. */
.dsh-privacy-busy { position: fixed; right: 18px; bottom: 18px; z-index: 55; display: flex; pointer-events: none; animation: dsh-privacy-fade .18s ease both; }
.dsh-privacy-busy-card { pointer-events: auto; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); border: .5px solid var(--dsw-alias-border-l2); box-shadow: var(--dsw-shadow-overlay, 0 18px 48px rgba(0, 0, 0, .28)); font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsh-privacy-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l3); border-top-color: var(--dsw-alias-brand-primary); animation: dsh-privacy-spin .9s linear infinite; }
@keyframes dsh-privacy-spin { to { transform: rotate(360deg); } }
@keyframes dsh-privacy-fade { from { opacity: 0; } to { opacity: 1; } }
.dsh-privacy-chip[data-busy='true'] .dsh-privacy-dot { animation: dsh-privacy-pulse 1s ease-in-out infinite; }
@keyframes dsh-privacy-pulse { 50% { opacity: .25; } }

/* Frosted cover for a conversation marked private: the point is that someone standing
   behind the screen cannot read it, while the page keeps working underneath. */
.dsh-privacy-frost { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1; backdrop-filter: blur(14px) saturate(.7); background: rgba(0, 0, 0, .3); pointer-events: none; animation: dsh-privacy-fade .2s ease both; }
.dsh-privacy-frost-card { position: fixed; right: 24px; bottom: 24px; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); border: .5px solid var(--dsw-alias-border-l2); box-shadow: var(--dsw-shadow-overlay, 0 18px 48px rgba(0, 0, 0, .28)); font-size: 12px; color: var(--dsw-alias-label-primary); pointer-events: auto; }
`

    function dictFor(locale) {
      // The locale service publishes a snapshot `{ active, locales, revision }`, not
      // a bare id. Reading `.id` here silently produced English for every language,
      // which is exactly the bug this function now guards against: take the active
      // id from whatever shape arrives, then fall back to the browser, then to the
      // plugin's own language.
      const raw = locale !== null && typeof locale === 'object' ? (locale.active ?? locale.id ?? '') : (locale ?? '')
      let id = String(raw).toLowerCase()
      if (id === '' && typeof navigator !== 'undefined') id = String(navigator.language ?? '').toLowerCase()
      if (id === '' && typeof document !== 'undefined') id = String(document.documentElement?.lang ?? '').toLowerCase()
      if (id === '') return DICT['zh-CN']
      if (id.startsWith('zh')) return DICT['zh-CN']
      if (id.startsWith('en')) return DICT['en-US']
      return typeof navigator !== 'undefined' && String(navigator.language ?? '').toLowerCase().startsWith('zh')
        ? DICT['zh-CN']
        : DICT['en-US']
    }

    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        values !== null && values !== undefined && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole,
      )
    }

    /* ------------------------------------------------------------------ *
     * Fingerprint / security key (WebAuthn platform authenticator)
     * ------------------------------------------------------------------ */

    function toBase64Url(buffer) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
      let text = ''
      for (const byte of bytes) text += String.fromCharCode(byte)
      return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
    }

    function fromBase64Url(text) {
      const raw = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'))
      const bytes = new Uint8Array(raw.length)
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
      return bytes
    }

    /**
     * A platform authenticator needs a registrable host name. `localhost` qualifies;
     * a bare IP literal does not, and Chromium rejects it with "Public-key credentials
     * are only available to HTTPS origins ... that fall under 'localhost'". The status
     * carries the reason so the UI can say what to do instead of showing that text.
     */
    function webAuthnStatus() {
      if (typeof window === 'undefined') return { ok: false, code: 'no-window' }
      if (typeof window.PublicKeyCredential !== 'function') return { ok: false, code: 'no-api' }
      const host = String(window.location?.hostname ?? '')
      if (host === '') return { ok: false, code: 'no-host' }
      if (window.isSecureContext === false) return { ok: false, code: 'insecure', host }
      if (host === 'localhost') return { ok: true, code: 'ok', host }
      if (/^[0-9.]+$/u.test(host) || host.includes(':')) return { ok: false, code: 'ip', host }
      return { ok: true, code: 'ok', host }
    }

    function webAuthnReady() {
      return webAuthnStatus().ok
    }

    function webAuthnHint(dict) {
      const status = webAuthnStatus()
      if (status.ok) return null
      if (status.code === 'ip') return format(dict.credentialUnavailableIp, { host: status.host })
      if (status.code === 'insecure') return format(dict.credentialUnavailableIp, { host: status.host })
      return dict.credentialUnavailableApi
    }

    /** Map a WebAuthn failure to copy the user can act on. */
    function credentialFailure(dict, result) {
      const code = String(result?.error ?? '')
      if (code === 'cancelled') return dict.credentialCancelled
      if (code === 'webauthn-unavailable') return webAuthnHint(dict) ?? dict.credentialUnavailableApi
      return format(dict.credentialFailed, { why: code === '' ? 'unknown' : code })
    }

    function credentialErrorCode(error) {
      const name = String(error?.name ?? '')
      if (name === 'NotAllowedError') return 'cancelled'
      if (name === 'SecurityError') return 'webauthn-unavailable'
      if (name === 'AbortError') return 'cancelled'
      return error instanceof Error ? error.message : String(error)
    }

    async function registerCredential(store, purpose) {
      const begin = await store.send('/webauthn/register/begin', {})
      if (!begin.ok) return begin
      const publicKey = {
        challenge: fromBase64Url(begin.result.challenge),
        rp: { name: begin.result.rp?.name ?? 'DeepSeek Harness' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: begin.result.user?.name ?? 'dsh-privacy-mode',
          displayName: begin.result.user?.displayName ?? 'DSH',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
        attestation: 'none',
      }
      const created = await (async () => {
        try {
          return await navigator.credentials.create({ publicKey })
        } catch (error) {
          return { error }
        }
      })()
      if (created instanceof Error || created?.error !== undefined) {
        return { ok: false, result: { error: credentialErrorCode(created.error ?? created) }, status: 0 }
      }
      if (created === null) return { ok: false, result: { error: 'cancelled' }, status: 0 }
      return store.send('/webauthn/register/finish', {
        challenge: begin.result.challenge,
        clientDataJSON: toBase64Url(created.response.clientDataJSON),
        attestationObject: toBase64Url(created.response.attestationObject),
        ...purpose === undefined ? {} : { purpose },
      })
    }

    /**
     * Ask the platform authenticator for an assertion. On Windows the prompt accepts
     * the PC PIN as well as a fingerprint, which is what "recover with the computer
     * PIN" relies on — the PIN itself never leaves the system dialog.
     */
    async function assertionFor(store, { purpose, sessionId } = {}) {
      const begin = await store.send('/webauthn/assert/begin', {})
      if (!begin.ok) return begin
      const publicKey = {
        challenge: fromBase64Url(begin.result.challenge),
        allowCredentials: (begin.result.allowCredentials ?? []).map((item) => ({ type: item.type, id: fromBase64Url(item.id) })),
        userVerification: 'required',
        timeout: 60000,
      }
      const assertion = await (async () => {
        try {
          return await navigator.credentials.get({ publicKey })
        } catch (error) {
          return { error }
        }
      })()
      if (assertion instanceof Error || assertion?.error !== undefined) {
        return { ok: false, result: { error: credentialErrorCode(assertion.error ?? assertion) }, status: 0 }
      }
      if (assertion === null) return { ok: false, result: { error: 'cancelled' }, status: 0 }
      return store.send('/webauthn/assert/finish', {
        challenge: begin.result.challenge,
        credentialId: toBase64Url(assertion.rawId),
        clientDataJSON: toBase64Url(assertion.response.clientDataJSON),
        authenticatorData: toBase64Url(assertion.response.authenticatorData),
        signature: toBase64Url(assertion.response.signature),
        ...purpose === undefined ? {} : { purpose },
        ...sessionId === undefined ? {} : { sessionId },
      })
    }

    async function unlockWithCredential(store, sessionId) {
      return assertionFor(store, { sessionId })
    }

    async function recoverWithCredential(store) {
      return assertionFor(store, { purpose: 'recover' })
    }

    /**
     * The blur belongs to the conversation pane only: the navigation on the left and
     * the shell's own chrome stay readable. The left edge comes from the frame's own
     * grid definition (the sidebar is a grid column, not an `<aside>`), and the layer
     * sits low in the stacking order so a sticky header paints above it instead of
     * being blurred.
     */
    function frostInsets() {
      try {
        if (typeof document === 'undefined') return { left: '0px', top: '0px' }
        const frame = document.querySelector('[data-shell-bottom]')?.parentElement ?? null
        let left = 0
        if (frame !== null) {
          try {
            const columns = String(window.getComputedStyle(frame).gridTemplateColumns ?? '')
            const first = columns.trim().split(/\s+/u)[0] ?? ''
            const parsed = Number.parseFloat(first)
            if (Number.isFinite(parsed) && parsed > 0) left = parsed
          } catch {
            left = 0
          }
        }
        if (left === 0) {
          const side = document.querySelector('aside')
          left = Number(side?.getBoundingClientRect?.().right ?? 0)
        }
        return { left: `${Math.max(0, Math.round(left))}px`, top: '0px' }
      } catch {
        return { left: '0px', top: '0px' }
      }
    }

    /**
     * A poll without `titles=1` carries session ids where an earlier poll carried
     * names. Keep the names, or the sidebar rows fall back to ids every few seconds.
     */
    function mergeTitles(next, previous) {
      if (next === null || previous === null) return next
      if (!Array.isArray(next.sessions) || !Array.isArray(previous.sessions)) return next
      const known = new Map()
      for (const session of previous.sessions) {
        if (typeof session?.id === 'string' && typeof session.title === 'string' && session.title !== session.id) {
          known.set(session.id, session.title)
        }
      }
      if (known.size === 0) return next
      next.sessions = next.sessions.map((session) =>
        known.has(session.id) && (session.title === undefined || session.title === session.id)
          ? { ...session, title: known.get(session.id) }
          : session)
      return next
    }

    function createClientStore() {
      let current = { loading: true, error: '', state: null }
      let timer = null
      const listeners = new Set()
      let inFlight = null

      async function load(options) {
        const titles = options?.titles === true
        const wait = options?.wait === true
        // A poll in flight would answer with the state from before the POST that just
        // finished, so a send asks for a fresh read instead of joining the old one.
        const force = options?.force === true
        if (inFlight !== null && !force) return inFlight
        inFlight = (async () => {
          const query = []
          if (titles) query.push('titles=1')
          if (wait) query.push('wait=1')
          try {
            const response = await fetch(`${ROUTE}/state${query.length > 0 ? `?${query.join('&')}` : ''}`, { cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const state = mergeTitles(await response.json(), current.state)
            current = { loading: false, error: '', state }
          } catch (error) {
            current = { loading: false, error: error instanceof Error ? error.message : String(error), state: current.state }
          } finally {
            inFlight = null
            for (const listener of [...listeners]) listener()
          }
        })()
        return inFlight
      }

      async function send(path, body) {
        try {
          const response = await fetch(`${ROUTE}${path}`, {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body ?? {}),
          })
          const result = await response.json().catch(() => ({}))
          await load({ force: true })
          return { ok: response.ok && result.ok !== false, result, status: response.status }
        } catch (error) {
          return { ok: false, result: { error: error instanceof Error ? error.message : String(error) }, status: 0 }
        }
      }

      async function audit() {
        try {
          const response = await fetch(`${ROUTE}/audit?limit=30`, { cache: 'no-store' })
          if (!response.ok) return { entries: [], path: '' }
          return await response.json()
        } catch {
          return { entries: [], path: '' }
        }
      }

      function stop() {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
      }

      /**
       * One shared poll. It tightens to `FAST_POLL_MS` while a switch job is running,
       * so the chip stops saying "switching" within a second of the Host finishing.
       */
      function schedule() {
        stop()
        if (listeners.size === 0) return
        const running = current.state?.job?.status === 'running'
        timer = setTimeout(async () => {
          timer = null
          if (!(typeof document !== 'undefined' && document.hidden === true)) await load()
          schedule()
        }, running ? FAST_POLL_MS : POLL_MS)
      }

      function subscribe(listener) {
        listeners.add(listener)
        if (timer === null) {
          void load().finally(schedule)
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) stop()
        }
      }

      return { get: () => current, subscribe, load, send, audit }
    }

    function useSnapshot(store) {
      const [snapshot, setSnapshot] = React.useState(() => store.get())
      React.useEffect(() => store.subscribe(() => setSnapshot(store.get())), [store])
      return snapshot
    }

    function useLocale(ctx) {
      const read = () => dictFor(typeof ctx.locale?.getLocale === 'function' ? ctx.locale.getLocale() : 'en-US')
      const [dict, setDict] = React.useState(read)
      React.useEffect(() => {
        if (typeof ctx.locale?.subscribe !== 'function') return undefined
        return ctx.locale.subscribe(() => setDict(read()))
      }, [])
      return dict
    }

    /**
     * Grouped workspace list, mounted only while PRIVATE is on.
     *
     * It shadows the single `sidebar.workspaces` slot, so it has to stay a full
     * navigator: a workspace row opens that workspace, a session row opens the
     * session, and the caret only folds the rows underneath. Replacing a navigation
     * surface with something that cannot navigate is how a convenience turns into a
     * dead end, so every row keeps its job.
     *
     *  - 隐私工作区: workspaces marked private, with only their own sessions;
     *  - 常规工作区: the rest, with their sessions plus the sessions marked private —
     *    exactly the set that may appear only inside PRIVATE.
     *
     * The footer's "还原原生列表" disposes the shadow for the rest of the session: a
     * replaced surface needs a way back that does not depend on the replacement.
     */
    function PrivacyWorkspaceGroups({ ctx, store, onRestore }) {
      const dict = useLocale(ctx)
      const snapshot = useSnapshot(store)
      const state = snapshot.state
      const [collapsed, setCollapsed] = React.useState({ normal: false, private: false })
      const [folded, setFolded] = React.useState({})
      const MAX_SESSIONS = 20

      React.useEffect(() => {
        void store.load({ titles: true })
      }, [store])

      if (state === null) {
        return h('div', { className: 'dsh-privacy dsh-privacy-groups' }, h('style', null, CSS),
          h('p', { className: 'dsh-privacy-empty' }, snapshot.loading ? dict.loading : format(dict.error, { why: snapshot.error || 'unknown' })),
          h('button', { type: 'button', className: 'dsh-privacy-button', onClick: onRestore }, dict.restoreNative))
      }

      const openWorkspace = (id) => {
        try {
          const opened = ctx.uiWorkspace?.openWorkspace?.(id)
          if (opened !== undefined && typeof opened.catch === 'function') opened.catch(() => {})
        } catch {
          // The shell owns navigation; a refusal must not break the list.
        }
      }
      const openSession = (id) => {
        try {
          ctx.uiWorkspace?.openSession?.(id)
        } catch {
          // Same: opening is the shell's job.
        }
      }
      const sessionsOf = (workspaceId) => (state.sessions ?? [])
        .filter((session) => session.workspaceId === workspaceId && session.classification !== 'private')
      // A chat marked private leaves the tree immediately; it stays reachable from the
      // one collapsed "hidden" list rather than from every workspace it used to sit in.
      const hiddenSessions = (state.sessions ?? []).filter((session) => session.classification === 'private')
      const workspaceTitle = (id) => (state.workspaces ?? []).find((workspace) => workspace.id === id)?.title ?? ''
      const showHidden = collapsed.hidden === true
      const groups = [
        {
          key: 'private',
          title: dict.privateGroup,
          workspaces: (state.workspaces ?? []).filter((workspace) => workspace.classification === 'private'),
          tone: 'private',
        },
        {
          key: 'normal',
          title: dict.normalGroup,
          workspaces: (state.workspaces ?? []).filter((workspace) => workspace.classification !== 'private'),
          tone: 'normal',
        },
      ]

      return h('div', { className: 'dsh-privacy dsh-privacy-groups', 'data-testid': 'privacy-workspace-groups' },
        h('style', null, CSS),
        groups.map((group) => {
          const isCollapsed = collapsed[group.key] === true
          return h('div', { key: group.key },
            h('button', {
              type: 'button',
              className: 'dsh-privacy-group-head',
              'data-tone': group.tone,
              'aria-expanded': isCollapsed ? 'false' : 'true',
              onClick: () => setCollapsed({ ...collapsed, [group.key]: !isCollapsed }),
            },
              h('span', { className: 'dsh-privacy-caret', 'data-collapsed': isCollapsed ? 'true' : 'false' }, '▾'),
              h('span', null, group.title),
              h('span', { className: 'dsh-privacy-group-count' }, format(dict.count, { n: group.workspaces.length }))),
            isCollapsed ? null : h('div', { className: 'dsh-privacy-card' },
              group.workspaces.length === 0
                ? h('p', { className: 'dsh-privacy-empty' }, dict.empty)
                : group.workspaces.map((workspace) => {
                  const sessions = sessionsOf(workspace.id)
                  const hiddenHere = hiddenSessions.filter((session) => session.workspaceId === workspace.id).length
                  const total = sessions.length + hiddenHere
                  const isOpen = folded[workspace.id] !== true
                  const shown = sessions.slice(0, MAX_SESSIONS)
                  return h('div', { key: workspace.id },
                    h('div', { className: 'dsh-privacy-ws dsh-privacy-ws-row' },
                      h('button', {
                        type: 'button',
                        className: 'dsh-privacy-caret-btn',
                        title: isOpen ? dict.collapse : dict.expand,
                        'aria-label': isOpen ? dict.collapse : dict.expand,
                        onClick: () => setFolded({ ...folded, [workspace.id]: isOpen }),
                      }, h('span', { className: 'dsh-privacy-caret', 'data-collapsed': isOpen ? 'false' : 'true' }, '▾')),
                      h('button', {
                        type: 'button',
                        className: 'dsh-privacy-ws-main',
                        title: workspace.path || workspace.id,
                        onClick: () => openWorkspace(workspace.id),
                      }, h('span', { className: 'dsh-privacy-ws-title' }, workspace.title || workspace.id)),
                      h('span', { className: 'dsh-privacy-group-count' }, format(dict.sessionsCount, { n: total }))),
                    isOpen ? (sessions.length === 0
                      ? h('p', { className: 'dsh-privacy-empty' }, total === 0 ? dict.empty : format(dict.allHidden, { n: total }))
                      : shown.map((session) => h('button', {
                        key: session.id,
                        type: 'button',
                        className: 'dsh-privacy-ws dsh-privacy-session',
                        title: session.id,
                        onClick: () => openSession(session.id),
                      },
                        h('span', { className: 'dsh-privacy-ws-title' }, session.title || session.id),
                        session.classification === 'private'
                          ? h('span', { className: 'dsh-privacy-badge' }, dict.badgePrivate)
                          : null)).concat(sessions.length > shown.length
                        ? [h('p', { key: 'more', className: 'dsh-privacy-empty' }, format(dict.moreSessions, { n: sessions.length - shown.length }))]
                        : [])) : null)
                })))
        }),
        h('div', { className: 'dsh-privacy-groups-foot' },
          hiddenSessions.length === 0
            ? null
            : h('button', {
              type: 'button',
              className: 'dsh-privacy-group-head',
              'data-tone': 'private',
              'aria-expanded': showHidden ? 'true' : 'false',
              onClick: () => setCollapsed({ ...collapsed, hidden: !showHidden }),
            },
              h('span', { className: 'dsh-privacy-caret', 'data-collapsed': showHidden ? 'false' : 'true' }, '▾'),
              h('span', null, dict.hiddenChats),
              h('span', { className: 'dsh-privacy-group-count' }, format(dict.count, { n: hiddenSessions.length }))),
          hiddenSessions.length === 0 || !showHidden ? null : h('div', { className: 'dsh-privacy-card' },
            hiddenSessions.map((session) => h('button', {
              key: session.id,
              type: 'button',
              className: 'dsh-privacy-ws dsh-privacy-session',
              title: session.id,
              onClick: () => openSession(session.id),
            },
              h('span', { className: 'dsh-privacy-ws-title' }, session.title || session.id),
              h('span', { className: 'dsh-privacy-group-count' }, workspaceTitle(session.workspaceId))))),
          h('button', { type: 'button', className: 'dsh-privacy-button', onClick: onRestore }, dict.restoreNative)))
    }

    function PinSetup({ dict, onSubmit, onCancel, onCredential, busy, error, canUseCredential, hint }) {
      const [pin, setPin] = React.useState({ first: '', second: '' })
      const mismatch = pin.second !== '' && pin.first !== pin.second
      const ready = pin.first.length >= 4 && pin.first === pin.second
      const submit = (event) => {
        event.preventDefault()
        if (busy || !ready) return
        void onSubmit(pin.first, pin.second)
      }
      return h(
        'form',
        { className: 'dsh-privacy dsh-privacy-dialog', onSubmit: submit, 'data-testid': 'privacy-pin-setup' },
        h('div', { className: 'dsh-privacy-dialog-head' },
          h('h2', { className: 'dsh-privacy-dialog-title' }, dict.pinSetupTitle),
          h('button', { type: 'button', className: 'dsh-privacy-button', onClick: onCancel }, dict.cancel)),
        h('p', { className: 'dsh-privacy-hint' }, dict.pinSetupHint),
        hint ? h('p', { className: 'dsh-privacy-hint' }, hint) : null,
        h('div', { className: 'dsh-privacy-inline' },
          h('input', {
            className: 'dsh-privacy-input',
            type: 'password',
            autoFocus: true,
            autoComplete: 'new-password',
            placeholder: dict.pinNew,
            value: pin.first,
            onChange: (event) => setPin({ ...pin, first: event.target.value }),
          }),
          h('input', {
            className: 'dsh-privacy-input',
            type: 'password',
            autoComplete: 'new-password',
            placeholder: dict.pinConfirm,
            value: pin.second,
            onChange: (event) => setPin({ ...pin, second: event.target.value }),
          })),
        mismatch ? h('p', { className: 'dsh-privacy-error' }, dict.pinConfirmMismatch) : null,
        error !== '' ? h('p', { className: 'dsh-privacy-error' }, error) : null,
        h('div', { className: 'dsh-privacy-inline' },
          h('button', { type: 'submit', className: 'dsh-privacy-button dsh-privacy-primary', disabled: busy || !ready },
            busy ? dict.switching : dict.confirm),
          canUseCredential
            ? h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy, onClick: onCredential }, dict.credentialAdd)
            : null),
      )
    }

    function ShieldIcon({ size }) {
      const px = size ?? 16
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: px, height: px, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M12 2.5 4 5.6v6.1c0 4.6 3.4 8.3 8 9.8 4.6-1.5 8-5.2 8-9.8V5.6Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M12 8.4v6.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    function GearIcon({ size }) {
      const px = size ?? 14
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: px, height: px, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('circle', { cx: 12, cy: 12, r: 3.2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', {
          d: 'M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.9 5.9l1.4 1.4M16.7 16.7l1.4 1.4M18.1 5.9l-1.4 1.4M7.3 16.7l-1.4 1.4',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      )
    }

    function RecoverPrompt({ dict, state, onVerify, onCancel, busy, error, canUseCredential, hint }) {
      return h('div', { className: 'dsh-privacy dsh-privacy-dialog', 'data-testid': 'privacy-recover' },
        h('div', { className: 'dsh-privacy-dialog-head' },
          h('h2', { className: 'dsh-privacy-dialog-title' }, dict.recoverTitle),
          h('button', { type: 'button', className: 'dsh-privacy-button', onClick: onCancel }, dict.cancel)),
        h('p', { className: 'dsh-privacy-hint' }, dict.recoverHint),
        canUseCredential ? null : h('p', { className: 'dsh-privacy-error' }, hint),
        error !== '' ? h('p', { className: 'dsh-privacy-error' }, error) : null,
        h('div', { className: 'dsh-privacy-inline' },
          h('button', {
            type: 'button',
            className: 'dsh-privacy-button dsh-privacy-primary',
            disabled: busy || !canUseCredential,
            onClick: onVerify,
          }, busy ? dict.switching : dict.recoverAction)),
        state?.hasCredential === true ? null : h('p', { className: 'dsh-privacy-hint' }, dict.credentialUnset))
    }

    function PinPrompt({ dict, target, onSubmit, onCancel, busy, error, onCredential, credentialLabel, onForgot }) {
      const [pin, setPin] = React.useState('')
      React.useEffect(() => setPin(''), [target])
      const submit = (event) => {
        event.preventDefault()
        if (busy) return
        void onSubmit(pin)
      }
      return h(
        'form',
        { className: 'dsh-privacy dsh-privacy-dialog', onSubmit: submit, 'data-testid': 'privacy-pin' },
        h(
          'div',
          { className: 'dsh-privacy-dialog-head' },
          h('h2', { className: 'dsh-privacy-dialog-title' }, dict.currentMode),
          h('button', { type: 'button', className: 'dsh-privacy-button', onClick: onCancel }, dict.cancel),
        ),
        h(
          'div',
          { className: 'dsh-privacy-inline' },
          h('label', { className: 'dsh-privacy-note', htmlFor: 'privacy-pin-input' }, dict.pinLabel),
          h('input', {
            id: 'privacy-pin-input',
            className: 'dsh-privacy-input',
            type: 'password',
            autoFocus: true,
            autoComplete: 'current-password',
            placeholder: dict.pinPlaceholder,
            value: pin,
            onChange: (event) => setPin(event.target.value),
          }),
          h('button', { type: 'submit', className: 'dsh-privacy-button dsh-privacy-primary', disabled: busy || pin === '' },
            busy ? dict.switching : dict.confirm),
          onCredential
            ? h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy, onClick: onCredential }, credentialLabel)
            : null,
        ),
        onForgot === undefined
          ? null
          : h('button', {
            type: 'button',
            className: 'dsh-privacy-button',
            style: { alignSelf: 'flex-start', border: 0, padding: 0, height: 'auto', color: 'var(--dsw-alias-label-tertiary)' },
            disabled: busy,
            onClick: onForgot,
          }, dict.forgotPassword),
        error !== '' ? h('p', { className: 'dsh-privacy-error' }, error) : null,
      )
    }

    function ClassificationSelect({ dict, labels, value, onChange }) {
      const set = labels ?? { private: dict.clsPrivate, public: dict.clsPublic }
      return h(
        'select',
        {
          className: 'dsh-privacy-select',
          value,
          onChange: (event) => onChange(event.target.value),
          'aria-label': dict.classification,
        },
        h('option', { value: 'unclassified' }, dict.clsNone),
        h('option', { value: 'public' }, set.public),
        h('option', { value: 'private' }, set.private),
      )
    }

    function Manager({ ctx, store, dict, onClose, onEnterPrivate }) {
      const snapshot = useSnapshot(store)
      const [audit, setAudit] = React.useState({ entries: [], path: '' })
      const [pin, setPin] = React.useState({ next: '', confirm: '', current: '' })
      const [message, setMessage] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const state = snapshot.state

      React.useEffect(() => {
        void store.load({ titles: true, wait: true })
        void store.audit().then(setAudit)
      }, [store, snapshot.state?.mode])

      // The audit panel follows the job, not the mode: a finished switch adds a line.
      React.useEffect(() => {
        const status = snapshot.state?.job?.status
        if (status !== 'done' && status !== 'failed') return
        void store.audit().then(setAudit)
      }, [store, snapshot.state?.job?.status])

      const refresh = async () => {
        await store.load({ titles: true, wait: true })
        setAudit(await store.audit())
      }

      const mark = async (kind, id, classification) => {
        setBusy(true)
        const outcome = await store.send('/mark', { kind, id, classification })
        setBusy(false)
        setMessage(outcome.ok ? dict.switching : format(dict.failed, { why: describe(outcome.result) }))
      }

      /** One write for the whole section: a per-item loop would queue one job each. */
      const bulk = async (section, classification) => {
        const items = (Array.isArray(section.items) ? section.items : [])
          .filter((item) => !(section.kind === 'bundle' && item.self === true))
          .map((item) => ({
            kind: section.kind,
            id: section.kind === 'bundle' ? item.name : item.id,
            classification,
          }))
        if (items.length === 0) return
        setBusy(true)
        const outcome = await store.send('/mark-bulk', { items })
        setBusy(false)
        setMessage(outcome.ok ? format(dict.bulkApplied, { n: items.length }) : format(dict.failed, { why: describe(outcome.result) }))
      }

      const switchMode = async (target) => {
        setBusy(true)
        const outcome = await store.send('/switch', { target })
        setBusy(false)
        if (!outcome.ok) {
          setMessage(format(dict.failed, { why: describe(outcome.result) }))
          return
        }
        setMessage(dict.switching)
      }

      const savePin = async () => {
        if (pin.next !== pin.confirm) {
          setMessage(dict.pinConfirmMismatch)
          return
        }
        setBusy(true)
        const outcome = await store.send('/pin', { pin: pin.next, confirm: pin.confirm, currentPin: pin.current })
        setBusy(false)
        if (!outcome.ok) {
          setMessage(outcome.result?.error === 'pin-too-short' ? dict.pinTooShort
            : outcome.result?.error === 'pin-confirm-mismatch' ? dict.pinConfirmMismatch
              : outcome.result?.error === 'current-pin-mismatch' ? dict.pinMismatch
                : format(dict.failed, { why: describe(outcome.result) }))
          return
        }
        setPin({ next: '', confirm: '', current: '' })
        setMessage(dict.pinSaved)
      }

      const clearPin = async () => {
        setBusy(true)
        const outcome = await store.send('/pin', { clear: true, currentPin: pin.current })
        setBusy(false)
        if (!outcome.ok) {
          setMessage(outcome.result?.error === 'current-pin-mismatch' ? dict.pinMismatch
            : format(dict.failed, { why: describe(outcome.result) }))
          return
        }
        setPin({ next: '', confirm: '', current: '' })
        setMessage(dict.pinCleared)
      }

      const addCredential = async () => {
        if (!webAuthnReady()) {
          setMessage(webAuthnHint(dict) ?? dict.credentialUnavailableApi)
          return
        }
        setBusy(true)
        try {
          const outcome = await registerCredential(store)
          setBusy(false)
          setMessage(outcome.ok ? dict.credentialAdded : credentialFailure(dict, outcome.result))
        } catch (error) {
          setBusy(false)
          setMessage(format(dict.credentialFailed, { why: error instanceof Error ? error.message : String(error) }))
        }
      }

      const removeCredential = async () => {
        setBusy(true)
        const outcome = await store.send('/webauthn/remove', {})
        setBusy(false)
        setMessage(outcome.ok ? dict.credentialRemoved : format(dict.failed, { why: describe(outcome.result) }))
      }

      if (snapshot.loading && state === null) {
        return h('div', { className: 'dsh-privacy dsh-privacy-dialog' }, h('p', { className: 'dsh-privacy-hint' }, dict.loading))
      }
      // The classification page is a PRIVATE surface. The server also refuses `/mark`
      // in NORMAL, so this is the visible half of the same rule.
      if (state !== null && state.mode !== 'private') {
        return h('div', { className: 'dsh-privacy dsh-privacy-dialog', 'data-testid': 'privacy-manager-locked' },
          h('style', null, CSS),
          h('div', { className: 'dsh-privacy-dialog-head' },
            h('h2', { className: 'dsh-privacy-dialog-title' }, dict.title),
            onClose === undefined ? null : h('button', { type: 'button', className: 'dsh-privacy-button', onClick: onClose }, dict.close)),
          h('p', { className: 'dsh-privacy-hint' }, dict.settingsLocked),
          h('div', { className: 'dsh-privacy-inline' },
            h('button', {
              type: 'button',
              className: 'dsh-privacy-button dsh-privacy-primary',
              onClick: () => {
                if (typeof onEnterPrivate === 'function') {
                  onEnterPrivate()
                  return
                }
                void switchMode('private')
              },
            }, dict.enterPrivate)))
      }
      if (state === null) {
        return h('div', { className: 'dsh-privacy dsh-privacy-dialog' },
          h('p', { className: 'dsh-privacy-error' }, format(dict.error, { why: snapshot.error || 'unknown' })),
          h('button', { type: 'button', className: 'dsh-privacy-button', onClick: refresh }, dict.refresh))
      }

      const row = (key, title, sub, control) =>
        h(
          'div',
          { className: 'dsh-privacy-row', key },
          h('div', { className: 'dsh-privacy-row-main' },
            h('span', { className: 'dsh-privacy-row-title', title: title }, title),
            sub === '' ? null : h('span', { className: 'dsh-privacy-row-sub', title: sub }, sub)),
          control,
        )

      const unclassified = []
      const sections = [
        { kind: 'bundle', title: dict.bundles, hint: dict.bundlesHint, labels: { private: dict.clsBundlePrivate, public: dict.clsBundlePublic }, items: state.bundles, name: (item) => item.title, sub: (item) => `${item.name} · ${item.version} · ${item.enabled ? dict.enabled : dict.disabled}` },
        { kind: 'workspace', title: dict.workspaces, hint: dict.workspacesHint, labels: { private: dict.clsWorkspacePrivate, public: dict.clsWorkspacePublic }, items: state.workspaces, name: (item) => item.title, sub: (item) => `${item.path} · ${format(dict.sessionsCount, { n: item.sessionCount })}` },
        { kind: 'session', title: dict.sessions, hint: dict.sessionsHint, labels: { private: dict.clsSessionPrivate, public: dict.clsSessionPublic }, items: state.sessions, name: (item) => item.title, sub: (item) => `${item.id}${item.archived ? ` · ${dict.archived}` : ''}` },
      ]

      const body = h('div', { className: 'dsh-privacy-dialog-body' },
        h('div', { className: 'dsh-privacy-section' },
          h('div', { className: 'dsh-privacy-section-head' }, h('span', { className: 'dsh-privacy-section-title' }, dict.modeSection)),
          h('div', { className: 'dsh-privacy-inline' },
            h('span', { className: 'dsh-privacy-pill', 'data-tone': state.mode === 'private' ? 'private' : '' },
              dict.modeName[state.mode] ?? state.mode),
            state.mode === 'normal'
              ? h('button', { type: 'button', className: 'dsh-privacy-button dsh-privacy-primary', disabled: busy, onClick: () => switchMode('private') }, dict.enterPrivate)
              : h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy, onClick: () => switchMode('normal') }, dict.leavePrivate),
            h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy, onClick: refresh }, dict.refresh))),

        h('div', { className: 'dsh-privacy-section' },
          h('div', { className: 'dsh-privacy-section-head' }, h('span', { className: 'dsh-privacy-section-title' }, dict.pinSection)),
          h('p', { className: 'dsh-privacy-hint' }, state.hasPin ? dict.pinSet : dict.pinUnset),
          h('div', { className: 'dsh-privacy-inline' },
            state.hasPin
              ? h('input', { className: 'dsh-privacy-input', type: 'password', placeholder: dict.pinCurrent, value: pin.current, onChange: (event) => setPin({ ...pin, current: event.target.value }) })
              : null,
            h('input', { className: 'dsh-privacy-input', type: 'password', autoComplete: 'new-password', placeholder: dict.pinNew, value: pin.next, onChange: (event) => setPin({ ...pin, next: event.target.value }) }),
            h('input', { className: 'dsh-privacy-input', type: 'password', autoComplete: 'new-password', placeholder: dict.pinConfirm, value: pin.confirm, onChange: (event) => setPin({ ...pin, confirm: event.target.value }) }),
            h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy || pin.next === '' || pin.next !== pin.confirm, onClick: savePin }, dict.pinSave),
            state.hasPin ? h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy, onClick: clearPin }, dict.pinClear) : null)),

        h('div', { className: 'dsh-privacy-section' },
          h('div', { className: 'dsh-privacy-section-head' }, h('span', { className: 'dsh-privacy-section-title' }, dict.credentialSection)),
          h('p', { className: 'dsh-privacy-hint' }, state.hasCredential ? dict.credentialSet : dict.credentialUnset),
          state.hasCredential
            ? h('p', { className: 'dsh-privacy-hint' }, `${dict.auditPath}: ${state.credential?.createdAt ?? ''}`)
            : null,
          h('div', { className: 'dsh-privacy-inline' },
            state.hasCredential
              ? h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy, onClick: removeCredential }, dict.credentialRemove)
              : h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy || !webAuthnReady(), onClick: addCredential }, dict.credentialAdd)),
          webAuthnReady() ? null : h('p', { className: 'dsh-privacy-hint' }, webAuthnHint(dict))),

        ...sections.map((section) => {
          const items = Array.isArray(section.items) ? section.items : []
          const pending = items.filter((item) => (item.classification ?? 'unclassified') === 'unclassified')
          if (pending.length > 0) unclassified.push({ section, pending })
          const shown = items.slice(0, 120)
          return h('div', { className: 'dsh-privacy-section', key: section.kind },
            h('div', { className: 'dsh-privacy-section-head' },
              h('span', { className: 'dsh-privacy-section-title' }, section.title),
              h('span', { className: 'dsh-privacy-row-sub' }, format(dict.count, { n: items.length }))),
            h('p', { className: 'dsh-privacy-hint' }, section.hint),
            h('div', { className: 'dsh-privacy-inline' },
              h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy || items.length === 0, onClick: () => bulk(section, 'private') }, dict.bulkPrivate),
              h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy || items.length === 0, onClick: () => bulk(section, 'public') }, dict.bulkPublic),
              h('button', { type: 'button', className: 'dsh-privacy-button', disabled: busy || items.length === 0, onClick: () => bulk(section, 'unclassified') }, dict.bulkNone)),
            h('div', { className: 'dsh-privacy-card' },
              shown.length === 0
                ? h('div', { className: 'dsh-privacy-row' }, h('span', { className: 'dsh-privacy-row-sub' }, dict.empty))
                : shown.map((item) =>
                  row(
                    `${section.kind}:${item.id ?? item.name}`,
                    section.name(item),
                    section.sub(item),
                    section.kind === 'bundle' && item.self === true
                      ? h('span', { className: 'dsh-privacy-pill' }, dict.clsPublic)
                      : h(ClassificationSelect, {
                        dict,
                        labels: section.labels,
                        value: item.classification ?? 'unclassified',
                        onChange: (next) => mark(section.kind, section.kind === 'bundle' ? item.name : item.id, next),
                      }),
                  )))
          )
        }),

        unclassified.length === 0
          ? null
          : h('div', { className: 'dsh-privacy-section' },
            h('div', { className: 'dsh-privacy-section-head' }, h('span', { className: 'dsh-privacy-section-title' }, dict.unclassified)),
            h('p', { className: 'dsh-privacy-hint' }, dict.unclassifiedHint),
            h('div', { className: 'dsh-privacy-card' },
              unclassified.flatMap(({ section, pending }) => pending.slice(0, 40).map((item) =>
                row(
                  `pending:${section.kind}:${item.id ?? item.name}`,
                  section.name(item),
                  section.kind,
                  h('span', { className: 'dsh-privacy-pill' }, dict.clsNone)))))),

        h('div', { className: 'dsh-privacy-section' },
          h('div', { className: 'dsh-privacy-section-head' }, h('span', { className: 'dsh-privacy-section-title' }, dict.audit)),
          h('p', { className: 'dsh-privacy-hint' }, `${dict.auditHint} ${dict.auditPath}: ${audit.path || state.auditPath || ''}`),
          audit.entries.length === 0
            ? h('p', { className: 'dsh-privacy-hint' }, dict.auditEmpty)
            : h('pre', { className: 'dsh-privacy-audit' },
              audit.entries.map((entry) => `${entry.at}  ${entry.action}  ${entry.actor}${entry.detail && Object.keys(entry.detail).length > 0 ? `  ${JSON.stringify(entry.detail)}` : ''}`).join('\n'))),
      )

      return h('div', { className: 'dsh-privacy dsh-privacy-dialog', 'data-testid': 'privacy-manager' },
        h('style', null, CSS),
        h('div', { className: 'dsh-privacy-dialog-head' },
          h('h2', { className: 'dsh-privacy-dialog-title' }, dict.title),
          onClose === undefined ? null : h('button', { type: 'button', className: 'dsh-privacy-button', onClick: onClose }, dict.close)),
        h('div', { className: 'dsh-privacy-inline' },
          h('span', { className: 'dsh-privacy-pill', 'data-tone': state.mode === 'private' ? 'private' : '' }, dict.modeName[state.mode] ?? state.mode),
          state.job?.status === 'running'
            ? h('span', { className: 'dsh-privacy-pill' }, state.job.waiting ? dict.waitingIdle : dict.switching)
            : null),
        message === '' ? null : h('p', { className: 'dsh-privacy-note' }, message),
        snapshot.error !== '' ? h('p', { className: 'dsh-privacy-error' }, format(dict.error, { why: snapshot.error })) : null,
        body)
    }

    function describe(result) {
      if (result === null || result === undefined) return 'unknown'
      if (typeof result.error === 'string' && result.error !== '') return result.error
      if (Array.isArray(result.problems) && result.problems.length > 0) return result.problems.join('; ')
      return 'unknown'
    }

    function apply(ctx) {
      const store = createClientStore()
      /** The session the composer is showing; the frost layer needs it and has no props. */
      let activeSessionId = ''
      const ui = { open: false, target: '', listeners: new Set() }
      const setUi = (next) => {
        Object.assign(ui, next)
        for (const listener of [...ui.listeners]) listener()
      }
      const uiSnapshot = () => ({ open: ui.open, target: ui.target })
      const subscribeUi = (listener) => {
        ui.listeners.add(listener)
        return () => ui.listeners.delete(listener)
      }

      const useUi = () => {
        const [value, setValue] = React.useState(uiSnapshot)
        React.useEffect(() => subscribeUi(() => setValue(uiSnapshot())), [])
        return value
      }

      // The one visual layer this plugin owns: in NORMAL, suppress the rows of the
      // workspaces and sessions it hides. `data-row-key` is the row identity the
      // shipped browser already renders; nothing else in the page is touched.
      const layerId = 'dsh-privacy-mode-row-filter'
      const applyRowFilter = (state) => {
        if (typeof document === 'undefined') return
        const existing = document.getElementById(layerId)
        if (state === null || state.mode !== 'normal' || state.config?.hideWorkspaceRows !== true) {
          if (existing !== null) existing.remove()
          return
        }
        const keys = []
        for (const workspace of state.workspaces ?? []) {
          if (workspace.classification !== 'private') continue
          keys.push(`[data-row-key="workspace:${workspace.id}"]`)
          for (const sessionId of workspace.sessionIds ?? []) keys.push(`[data-row-key="session:${sessionId}"]`)
        }
        for (const session of state.sessions ?? []) {
          if (session.classification !== 'private') continue
          keys.push(`[data-row-key="session:${session.id}"]`)
        }
        if (keys.length === 0) {
          if (existing !== null) existing.remove()
          return
        }
        const css = `${keys.join(',')}{display:none!important}`
        const element = existing ?? document.createElement('style')
        if (existing === null) {
          element.id = layerId
          document.head.appendChild(element)
        }
        element.textContent = css
      }

      ctx.effect(() => store.subscribe(() => applyRowFilter(store.get().state)), 'privacy-mode: row filter')
      ctx.effect(() => () => {
        const existing = typeof document === 'undefined' ? null : document.getElementById(layerId)
        if (existing !== null) existing.remove()
      }, 'privacy-mode: row filter cleanup')

      // Chip: this conversation's privacy, nothing else. The profile-wide switch lives
      // on the sidebar shield; a button under the composer that changed the whole
      // profile was reading as the wrong control.
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-privacy-mode-chip',
        order: 20,
      }, function PrivacyChip(props) {
        const dict = useLocale(ctx)
        const snapshot = useSnapshot(store)
        const state = snapshot.state
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState('')
        const mode = state?.mode ?? 'normal'
        const sessionId = props?.sessionId ?? props?.session?.id ?? ''
        const job = state?.job
        // A switch answers `accepted` before it runs; the job record is what tells the
        // chip it is still applying. A stale job (abandoned by the server after 30s)
        // must not keep the button dead.
        const switching = busy
          || job?.status === 'queued'
          || (job?.status === 'running' && job?.stale !== true)

        const session = sessionId === ''
          ? undefined
          : (state?.sessions ?? []).find((item) => item.id === sessionId)
        // A session inside a private workspace is private too, even when the session
        // itself was never marked: the workspace is what hides it.
        const privateWorkspace = session === undefined
          ? undefined
          : (state?.workspaces ?? []).find((workspace) => workspace.id === session.workspaceId && workspace.classification === 'private')
        const isPrivate = session?.classification === 'private' || privateWorkspace !== undefined
        const label = isPrivate ? dict.convPrivate : dict.convNormal
        // The frost layer lives in a slot without props; this is where it learns which
        // conversation is on screen.
        activeSessionId = sessionId

        const onClick = () => {
          // No state at all means the Host's route was unreachable; a disabled button
          // here would be a dead end with no way back, so the click retries instead.
          if (state === null) {
            void store.load({ wait: true })
            return
          }
          if (switching) return
          if (sessionId === '') {
            setError(dict.convNoSession)
            return
          }
          // Marking a conversation is a PRIVATE-only action, and the way in is the
          // profile switch — the same dialog the shield opens.
          if (mode !== 'private') {
            setUi({
              open: true,
              target: state.hasPin === true || state.hasCredential === true ? 'pin' : 'setup',
            })
            return
          }
          setBusy(true)
          setError('')
          void store.send('/mark', {
            kind: 'session',
            id: sessionId,
            classification: isPrivate ? 'unclassified' : 'private',
          }).then((outcome) => {
            setBusy(false)
            if (!outcome.ok) setError(describe(outcome.result))
          })
        }

        return h('button', {
          type: 'button',
          className: 'dsh-privacy dsh-privacy-chip',
          'data-mode': isPrivate ? 'private' : 'normal',
          'data-busy': switching ? 'true' : 'false',
          title: error !== '' ? error : (state === null ? dict.loading : dict.convHint),
          'aria-label': `${dict.chipTitle}: ${label}`,
          disabled: switching && state !== null,
          onClick,
        },
          h('style', null, CSS),
          h('span', { className: 'dsh-privacy-dot' }),
          switching ? dict.switching : label)
      }))

      // Next to the mode button, only while PRIVATE: the settings page is a private
      // surface, so it appears when the mode is on and folds away when it is off.
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-privacy-mode-settings',
        order: 21,
      }, function PrivacySettingsChip() {
        const dict = useLocale(ctx)
        const snapshot = useSnapshot(store)
        const state = snapshot.state
        if (state?.mode !== 'private') return null
        return h('button', {
          type: 'button',
          className: 'dsh-privacy dsh-privacy-chip dsh-privacy-chip-settings',
          title: dict.settingsChip,
          'aria-label': dict.settingsChip,
          onClick: () => setUi({ open: true, target: 'manager' }),
        }, h('style', null, CSS), h(GearIcon, { size: 14 }), dict.settingsChip)
      }))

      // Sidebar foot, button 1: the mode switch and nothing else. NORMAL asks for the
      // password straight away (no explanatory panel in between); PRIVATE leaves at
      // once, because leaving must never be blocked by the thing it protects.
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-privacy-mode-toggle',
        order: 30,
        label: () => 'Privacy mode',
      }, function PrivacyFooterToggle() {
        const dict = useLocale(ctx)
        const snapshot = useSnapshot(store)
        const state = snapshot.state
        const mode = state?.mode ?? 'normal'
        const [error, setError] = React.useState('')
        // A stale job is not a reason to stay locked: the server abandons it after 30s,
        // and until then the click only queues behind it.
        const stuck = state?.job?.status === 'queued'
          || (state?.job?.status === 'running' && state?.job?.stale !== true)
        const onClick = () => {
          if (mode === 'private') {
            setError('')
            void store.send('/switch', { target: 'normal' }).then((outcome) => {
              if (!outcome.ok) setError(describe(outcome.result))
            })
            return
          }
          setUi({
            open: true,
            target: state?.hasPin === true || state?.hasCredential === true ? 'pin' : 'setup',
          })
        }
        return h('button', {
          type: 'button',
          className: 'dsh-privacy dsh-privacy-icon-btn',
          title: error !== '' ? error : (mode === 'private' ? dict.leavePrivate : dict.enterPrivate),
          'aria-label': mode === 'private' ? dict.leavePrivate : dict.enterPrivate,
          'data-mode': mode,
          'data-busy': stuck ? 'true' : 'false',
          onClick,
        }, h('style', null, CSS), stuck
          ? h('span', { className: 'dsh-privacy-spinner' })
          : h(ShieldIcon, { size: 16 }))
      }))

      // Sidebar foot, button 2: the settings page. PRIVATE only — the classification
      // surface must not exist while NORMAL is on.
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-privacy-mode-settings',
        order: 31,
        label: () => 'Privacy settings',
      }, function PrivacyFooterSettings() {
        const dict = useLocale(ctx)
        const snapshot = useSnapshot(store)
        if (snapshot.state?.mode !== 'private') return null
        return h('button', {
          type: 'button',
          className: 'dsh-privacy dsh-privacy-icon-btn',
          title: dict.settingsChip,
          'aria-label': dict.settingsChip,
          onClick: () => setUi({ open: true, target: 'manager' }),
        }, h('style', null, CSS), h(GearIcon, { size: 16 }))
      }))

      // Settings page: PRIVATE only, for the same reason.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'privacy-mode',
        order: 45,
        label: () => 'Privacy mode',
      }, function PrivacySettingsSection() {
        const dict = useLocale(ctx)
        const snapshot = useSnapshot(store)
        if (snapshot.state?.mode !== 'private') return null
        return h('div', { className: 'dsh-privacy', style: { padding: '4px 0' } },
          h('style', null, CSS),
          h(Manager, {
            ctx,
            store,
            dict,
            onEnterPrivate: () => setUi({
              open: true,
              target: snapshot.state?.hasPin === true || snapshot.state?.hasCredential === true ? 'pin' : 'setup',
            }),
          }))
      }))

      // Grouped workspace list: shadows the shipped browser only while PRIVATE is on,
      // and steps aside for good when the user asks for the original list back. The
      // shadow is disposed on exit, so NORMAL always renders the shipped list.
      ctx.effect(() => {
        let allowed = true
        let registerEntry = null
        let disposeEntry = null
        const apply = () => {
          const mode = store.get().state?.mode ?? 'normal'
          const want = allowed && mode === 'private' && registerEntry !== null
          if (want && disposeEntry === null) {
            // A failed registration must not take the whole plugin down with it: the
            // shipped list stays, and every other surface keeps working.
            try {
              disposeEntry = registerEntry()
            } catch (error) {
              allowed = false
              console.warn('[privacy-mode] grouped sidebar unavailable, keeping the built-in list', error)
            }
            return
          }
          if (!want && disposeEntry !== null) {
            disposeEntry()
            disposeEntry = null
          }
        }
        const restore = () => {
          allowed = false
          apply()
        }
        const offInject = ctx.slots.inject('sidebar.workspaces', () => {
          registerEntry = () => ctx.slots.register({
            name: 'sidebar.workspaces',
            id: 'dsh-privacy-mode-groups',
          }, () => h(PrivacyWorkspaceGroups, { ctx, store, onRestore: restore }))
          apply()
          return () => {
            registerEntry = null
            apply()
          }
        })
        const offStore = store.subscribe(apply)
        return () => {
          offStore()
          offInject()
          if (disposeEntry !== null) {
            disposeEntry()
            disposeEntry = null
          }
        }
      }, 'privacy-mode: grouped sidebar')

      // Overlay host for the PIN prompt and the management dialog.
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-privacy-mode-overlay',
        order: 60,
      }, function PrivacyOverlay() {
        const dict = useLocale(ctx)
        const view = useUi()
        const snapshot = useSnapshot(store)
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState('')
        const [recovery, setRecovery] = React.useState('')

        // The switch runs in the background and usually takes a second or two; this
        // card is the click's immediate answer, and it fades in on its own.
        const busyNow = snapshot.state?.job?.status === 'running'
        const busyCard = busyNow
          ? h('div', { className: 'dsh-privacy dsh-privacy-busy', role: 'status', 'aria-live': 'polite' },
            h('style', null, CSS),
            h('div', { className: 'dsh-privacy-busy-card' },
              h('span', { className: 'dsh-privacy-spinner' }),
              snapshot.state?.job?.waiting ? dict.waitingIdle : dict.busySwitching))
          : null

        // A conversation marked private is frosted until it is unmarked; a conversation
        // that is private only because of its workspace is frosted in NORMAL and cannot
        // be unmarked here — the way out is entering private mode.
        const shown = activeSessionId === ''
          ? undefined
          : (snapshot.state?.sessions ?? []).find((item) => item.id === activeSessionId)
        const shownWorkspace = shown === undefined
          ? undefined
          : (snapshot.state?.workspaces ?? []).find((workspace) => workspace.id === shown.workspaceId)
        const markedPrivate = shown?.classification === 'private'
        const workspacePrivate = shownWorkspace?.classification === 'private'
        // Inside PRIVATE nothing is covered: the point of the mode is to read those
        // chats. The frost exists for the profile that is *not* private.
        const covered = snapshot.state?.mode !== 'private' && shown !== undefined && (markedPrivate || workspacePrivate)
        const insets = covered ? frostInsets() : undefined
        const frostCard = covered
          ? h('div', {
            className: 'dsh-privacy dsh-privacy-frost',
            style: { left: insets.left, top: insets.top },
            role: 'presentation',
            'data-testid': 'privacy-frost',
          },
            h('style', null, CSS),
            h('div', { className: 'dsh-privacy-frost-card' },
              h('span', { className: 'dsh-privacy-pill', 'data-tone': 'private' }, dict.convPrivate),
              h('span', { className: 'dsh-privacy-hint' }, markedPrivate ? dict.frostHint : dict.frostWorkspaceHint),
              markedPrivate
                ? h('button', {
                  type: 'button',
                  className: 'dsh-privacy-button',
                  onClick: () => { void store.send('/mark', { kind: 'session', id: shown.id, classification: 'unclassified' }) },
                }, dict.frostOff)
                : h('button', {
                  type: 'button',
                  className: 'dsh-privacy-button',
                  onClick: () => setUi({
                    open: true,
                    target: snapshot.state?.hasPin === true || snapshot.state?.hasCredential === true ? 'pin' : 'setup',
                  }),
                }, dict.frostEnter)))
          : null

        // While a switch runs its card wins: it reports the operation the whole profile
        // is waiting on, and the frost returns as soon as the job settles.
        if (!view.open) return busyCard ?? frostCard

        const close = () => {
          setError('')
          setRecovery('')
          setUi({ open: false, target: '' })
        }

        const scrim = (content) => h('div', {
          className: 'dsh-privacy dsh-privacy-scrim',
          role: 'presentation',
          onClick: (event) => { if (event.target === event.currentTarget) close() },
        }, h('style', null, CSS), content)

        const withCredential = async () => {
          setBusy(true)
          setError('')
          try {
            const outcome = await unlockWithCredential(store)
            setBusy(false)
            if (!outcome.ok) {
              setError(credentialFailure(dict, outcome.result))
              return
            }
            close()
          } catch (error) {
            setBusy(false)
            setError(format(dict.credentialFailed, { why: error instanceof Error ? error.message : String(error) }))
          }
        }
        const canUseCredential = snapshot.state?.hasCredential === true && webAuthnReady()

        if (view.target === 'setup') {
          const submitPin = async (pin, confirm) => {
            setBusy(true)
            setError('')
            const saved = await store.send('/pin', { pin, confirm })
            if (!saved.ok) {
              setBusy(false)
              setError(saved.result?.error === 'pin-confirm-mismatch' ? dict.pinConfirmMismatch
                : saved.result?.error === 'pin-too-short' ? dict.pinTooShort
                  : format(dict.failed, { why: describe(saved.result) }))
              return
            }
            const outcome = await store.send('/switch', { target: 'private', pin })
            setBusy(false)
            if (!outcome.ok) {
              setError(format(dict.failed, { why: describe(outcome.result) }))
              return
            }
            close()
          }
          return h('div', { className: 'dsh-privacy dsh-privacy-scrim', role: 'presentation', onClick: (event) => { if (event.target === event.currentTarget) close() } },
            h('style', null, CSS),
            h(PinSetup, {
              dict,
              onSubmit: submitPin,
              onCancel: close,
              onCredential: withCredential,
              busy,
              error,
              canUseCredential: webAuthnReady(),
              hint: webAuthnHint(dict),
            }))
        }

        if (view.target === 'pin') {
          const submit = async (pin) => {
            setBusy(true)
            setError('')
            const outcome = await store.send('/switch', { target: 'private', pin })
            setBusy(false)
            if (!outcome.ok) {
              setError(outcome.result?.error === 'pin-mismatch' ? dict.pinMismatch : format(dict.failed, { why: describe(outcome.result) }))
              return
            }
            close()
          }
          return scrim(h(PinPrompt, {
            dict,
            target: 'private',
            onSubmit: submit,
            onCancel: close,
            busy,
            error,
            onCredential: canUseCredential ? withCredential : null,
            credentialLabel: dict.unlockWithCredential,
            onForgot: () => { setError(''); setUi({ open: true, target: 'recover' }) },
          }))
        }

        // Forgot the password: the computer itself vouches for the user (Windows
        // Hello accepts the PC PIN), then a new password replaces the old one.
        if (view.target === 'recover') {
          const verify = async () => {
            setBusy(true)
            setError('')
            try {
              const outcome = snapshot.state?.hasCredential === true
                ? await recoverWithCredential(store)
                : await registerCredential(store, 'recover')
              setBusy(false)
              if (!outcome.ok) {
                setError(credentialFailure(dict, outcome.result))
                return
              }
              const token = String(outcome.result?.recovery ?? '')
              if (token === '') {
                setError(webAuthnHint(dict) ?? dict.recoverUnsupported)
                return
              }
              setRecovery(token)
              setUi({ open: true, target: 'reset' })
            } catch (error) {
              setBusy(false)
              setError(format(dict.credentialFailed, { why: error instanceof Error ? error.message : String(error) }))
            }
          }
          return scrim(h(RecoverPrompt, {
            dict,
            state: snapshot.state,
            onVerify: verify,
            onCancel: close,
            busy,
            error,
            canUseCredential: webAuthnReady(),
            hint: webAuthnHint(dict),
          }))
        }

        if (view.target === 'reset') {
          const submitRecovered = async (pin, confirm) => {
            setBusy(true)
            setError('')
            const saved = await store.send('/pin', { pin, confirm, recovery })
            if (!saved.ok) {
              setBusy(false)
              setError(saved.result?.error === 'pin-confirm-mismatch' ? dict.pinConfirmMismatch
                : saved.result?.error === 'pin-too-short' ? dict.pinTooShort
                  : format(dict.failed, { why: describe(saved.result) }))
              return
            }
            const outcome = await store.send('/switch', { target: 'private', pin })
            setBusy(false)
            if (!outcome.ok) {
              setError(format(dict.failed, { why: describe(outcome.result) }))
              return
            }
            close()
          }
          return scrim(h(PinSetup, {
            dict,
            onSubmit: submitRecovered,
            onCancel: close,
            busy,
            error,
            canUseCredential: false,
            hint: dict.recoverDone,
          }))
        }

        return scrim(h(Manager, {
          ctx,
          store,
          dict,
          onClose: close,
          onEnterPrivate: () => setUi({
            open: true,
            target: snapshot.state?.hasPin === true || snapshot.state?.hasCredential === true ? 'pin' : 'setup',
          }),
        }))
      }))
    }

    return {
      name: 'dsh-privacy-mode',
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
