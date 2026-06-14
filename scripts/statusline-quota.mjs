import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { join, basename } from 'path';
import os from 'os';

function getGitBranch(lang) {
  try {
    const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
    let branch = '';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
    } catch (err) {
      if (process.platform === 'win32') {
        const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe';
        if (existsSync(gitPath)) {
          branch = execSync(`"${gitPath}" rev-parse --abbrev-ref HEAD`, opts).trim();
        }
      }
    }
    return branch || (lang === 'zh-tw' ? '無版本控制' : (lang === 'jp' ? 'バージョン管理なし' : 'No VC'));
  } catch (e) {
    return lang === 'zh-tw' ? '無版本控制' : (lang === 'jp' ? 'バージョン管理なし' : 'No VC');
  }
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GRAY = "\x1b[90m";
const WHITE = "\x1b[38;2;255;255;255m";
const BLUE = "\x1b[38;2;87;202;255m";
const GREEN = "\x1b[38;2;92;219;109m";
const YELLOW = "\x1b[38;2;255;212;39m";
const RED = "\x1b[38;2;255;125;175m";

// 四階梯色彩辨識（Google Material 配色）：100~75% 藍、74~50% 綠、49~25% 黃、24~0% 紅
function getColorByPercentage(pct) {
  if (pct >= 75) return BLUE;
  if (pct >= 50) return GREEN;
  if (pct >= 25) return YELLOW;
  return RED;
}

// 計數型四階段（越多越警示）：0=藍、1-2=綠、3-4=黃、5+=紅
function getColorByCount(n) {
  if (n === 0) return BLUE;
  if (n <= 2) return GREEN;
  if (n <= 4) return YELLOW;
  return RED;
}

// 根據模型家族取得色彩 (Claude: #dd5013, Gemini: #4796e3, GPT: #74aa9c)
function getModelColor(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('claude')) return "\x1b[38;2;221;80;19m";
  if (lower.includes('gemini')) return "\x1b[38;2;71;150;227m";
  if (lower.includes('gpt') || lower.includes('chatgpt')) return "\x1b[38;2;116;170;156m";
  return "";
}

function getVcsDirtyColor(dirty) { return dirty ? RED : GREEN; }
function getToolConfirmColor(pending) { return pending ? YELLOW : GREEN; }
function getAgentStateColor(state) {
  const s = (state || '').toLowerCase();
  if (s.includes('error') || s.includes('fail')) return RED;
  if (s.includes('busy') || s.includes('run') || s.includes('think')) return YELLOW;
  if (s.includes('idle') || s.includes('ready')) return GREEN;
  return BLUE;
}
function getSandboxColor(enabled, allowNet) {
  if (!enabled) return RED;
  return allowNet ? YELLOW : GREEN;
}

// 清理 ANSI 碼以計算純文字長度
function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function getGitDirty() {
  try {
    const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
    let out = '';
    try {
      out = execSync('git status --porcelain', opts);
    } catch (err) {
      if (process.platform === 'win32') {
        const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe';
        if (existsSync(gitPath)) {
          out = execSync(`"${gitPath}" status --porcelain`, opts);
        }
      }
    }
    return out.trim().length > 0;
  } catch (e) {
    return false;
  }
}

function getCliMemoryMB() {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`powershell -NoProfile -Command "(Get-Process -Name 'agy' -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet -Sum).Sum"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const totalBytes = parseInt(output.trim(), 10);
      if (!isNaN(totalBytes)) {
        return Math.round(totalBytes / 1024 / 1024);
      }
    } else {
      const output = execSync(`ps -o rss= -p ${process.ppid}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const memKb = parseInt(output.trim(), 10);
      if (!isNaN(memKb)) return Math.round(memKb / 1024);
    }
  } catch (e) {}
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function getDisplayWidth(str) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    width += str.charCodeAt(i) > 0x7F ? 2 : 1;
  }
  return width;
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let timer = setTimeout(() => resolve(data), 50);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
  });
}

function getSettings() {
  const globalPath = join(os.homedir(), '.gemini', 'settings.json');
  const projectPath = join(process.cwd(), '.gemini', 'settings.json');
  let settings = {};
  try { if (existsSync(globalPath)) settings = JSON.parse(readFileSync(globalPath, 'utf8')); } catch (e) {}
  try {
    if (existsSync(projectPath)) {
      const projSettings = JSON.parse(readFileSync(projectPath, 'utf8'));
      settings = { ...settings, ...projSettings };
      if (projSettings.ui) {
        settings.ui = { ...settings.ui, ...projSettings.ui };
        if (projSettings.ui.footer) settings.ui.footer = { ...settings.ui.footer, ...projSettings.ui.footer };
      }
    }
  } catch (e) {}
  return settings;
}

function formatTokens(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function normalizeModelName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function main() {
  if (process.env.DISABLE_QUOTA_HOOK) process.exit(0);
  let meta = {};

  try {
    const stdinStr = await readStdin();
    try { if (stdinStr.trim()) meta = JSON.parse(stdinStr); } catch (e) {}

    const settings = getSettings();
    // 扣除 15 格的安全邊距，防止 CLI 左右 padding 導致過晚換行
    const termWidth = Math.max(40, (meta?.terminal_width || process.stdout.columns || 80) - 15);
    
    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    
    // 退讓模式：若使用者已還原，輸出預設 UI
    if (!settings?.ui?.footer?.items) {
      const leftText = '? for shortcuts';
      const rightText = fallbackModel;
      const spacesCount = Math.max(1, termWidth - getDisplayWidth(leftText) - getDisplayWidth(rightText) - 1);
      const spaces = ' '.repeat(spacesCount);
      console.log(`${leftText}${spaces}${rightText}`);
      process.exit(0);
    }
    
    const lang = settings?.ui?.language || 'zh-tw';
    const footerItems = settings.ui.footer.items;
    
    const cachePath = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
    let cache = null;
    let needUpdate = true;
    
    try {
      if (existsSync(cachePath)) {
        cache = JSON.parse(readFileSync(cachePath, 'utf8'));
        if (Date.now() - (cache.updatedAt || 0) < 30000) needUpdate = false;
      }
    } catch (e) {}

    if (needUpdate) {
      try {
        const updaterScript = join(os.homedir(), '.gemini', 'antigravity-cli', 'hooks', 'fetch-local-quota.mjs');
        if (existsSync(updaterScript)) {
          spawn('node', [updaterScript], {
            env: { ...process.env, DISABLE_QUOTA_HOOK: '1' },
            stdio: 'ignore',
            detached: true,
            windowsHide: true
          }).unref();
        }
      } catch (e) {}
    }

    const normModel = normalizeModelName(fallbackModel);
    let modelQuota = null;
    if (cache && cache.models) {
      // 第一優先：完全匹配
      if (cache.models[normModel]) {
        modelQuota = cache.models[normModel];
      } else {
        // 第二優先：子字串模糊匹配
        for (const k in cache.models) {
          if (normModel.includes(k) || k.includes(normModel)) {
            modelQuota = cache.models[k];
            break;
          }
        }
      }
      // 第三優先：同族群（family）匹配
      // 同一供應商的模型通常共享額度池（如 Claude 系列、GPT 系列）
      if (!modelQuota) {
        const families = ['claude', 'gemini', 'gpt'];
        const modelFamily = families.find(f => normModel.includes(f));
        if (modelFamily) {
          for (const k in cache.models) {
            if (k.includes(modelFamily)) {
              // 取同族群中額度最低的（最保守估計）
              if (!modelQuota || cache.models[k].remaining_percentage < modelQuota.remaining_percentage) {
                modelQuota = cache.models[k];
              }
            }
          }
        }
      }
    }
    // 若所有策略均無法匹配，使用快取中所有模型的最低額度而非預設 100%
    if (!modelQuota && cache && cache.models) {
      const allKeys = Object.keys(cache.models);
      if (allKeys.length > 0) {
        modelQuota = allKeys.reduce((min, k) =>
          cache.models[k].remaining_percentage < min.remaining_percentage ? cache.models[k] : min
        , cache.models[allKeys[0]]);
      }
    }
    if (!modelQuota) modelQuota = { remaining_percentage: 100, refreshes_in: '' };

    const quotaPct = modelQuota.remaining_percentage;
    const quotaColor = getColorByPercentage(quotaPct);
    const quotaVal = `${Math.round(quotaPct)}%`;
    
    const contextWindow = meta.context_window || {};
    const conversationId = meta.conversation_id || 'default';
    const ctxCachePath = join(os.homedir(), '.gemini', 'tmp', `ctx_${conversationId}.json`);
    
    let totalInput = contextWindow.total_input_tokens || 0;
    let totalOutput = contextWindow.total_output_tokens || 0;
    let usedPctNum = contextWindow.used_percentage || 0;
    let contextSize = contextWindow.context_window_size || 0;
    
    if (totalInput === 0 && totalOutput === 0) {
      try {
        if (existsSync(ctxCachePath)) {
          const cachedCtx = JSON.parse(readFileSync(ctxCachePath, 'utf8'));
          totalInput = cachedCtx.total_input_tokens || 0;
          totalOutput = cachedCtx.total_output_tokens || 0;
          if (cachedCtx.used_percentage) usedPctNum = cachedCtx.used_percentage;
          if (cachedCtx.context_window_size) contextSize = cachedCtx.context_window_size;
        }
      } catch (e) {}
    } else {
      try {
        mkdirSync(join(os.homedir(), '.gemini', 'tmp'), { recursive: true });
        writeFileSync(ctxCachePath, JSON.stringify({
          total_input_tokens: totalInput,
          total_output_tokens: totalOutput,
          used_percentage: usedPctNum,
          context_window_size: contextSize
        }), { encoding: 'utf8' });
      } catch (e) {}
    }
    
    if (!contextSize) contextSize = 1048576;
    
    if (contextSize > 0 && totalInput > 0 && !usedPctNum) {
      usedPctNum = (totalInput / contextSize) * 100;
    }
    
    const remainCtx = Math.max(0, 100 - usedPctNum);
    const contextColor = getColorByPercentage(remainCtx);
    const usedPct = `${usedPctNum.toFixed(1)}%`;
    
    const rssMem = getCliMemoryMB();
    const memUsage = `${rssMem}MB`;
    const totalTokens = totalInput;
    const tokenCount = `${contextColor}${formatTokens(totalTokens)}${RESET} / ${formatTokens(contextSize)}`;
    const countdownVal = modelQuota.refreshes_in || (lang === 'zh-tw' ? '無' : (lang === 'jp' ? 'なし' : 'N/A'));
    const gitBranch = getGitBranch(lang);
    const projectName = basename(process.cwd());
    const projectFullPath = process.cwd();
    
    const unknownStr = lang === 'zh-tw' ? '未知' : (lang === 'jp' ? '不明' : 'Unknown');
    
    // 存取帳號快取 (解決背景 redraw 時 meta 為空的問題)
    const accountMetaPath = join(os.homedir(), '.gemini', 'tmp', 'account_meta_cache.json');
    let cachedAccount = {};
    try { if (existsSync(accountMetaPath)) cachedAccount = JSON.parse(readFileSync(accountMetaPath, 'utf8')); } catch (e) {}
    
    if (meta && meta.account && (meta.account.email || meta.account.plan_tier || meta.account.ai_credits)) {
      if (meta.account.email) cachedAccount.email = meta.account.email;
      if (meta.account.plan_tier) cachedAccount.planTier = meta.account.plan_tier;
      if (meta.account.ai_credits) cachedAccount.aiCredits = meta.account.ai_credits;
      try { writeFileSync(accountMetaPath, JSON.stringify(cachedAccount), { encoding: 'utf8' }); } catch (e) {}
    }

    const planTier = (cache && cache.planTier) ? cache.planTier : (meta?.account?.plan_tier || cachedAccount.planTier || unknownStr);
    const accountEmail = (cache && cache.email) ? cache.email : (meta?.account?.email || cachedAccount.email || unknownStr);
    const aiCredits = (cache && cache.aiCredits) ? cache.aiCredits : (meta?.account?.ai_credits || cachedAccount.aiCredits || (lang === 'zh-tw' ? '無' : (lang === 'jp' ? 'なし' : 'N/A')));

    // === 新增 12 項指標的資料提取 ===
    const agentState = meta?.agent_state || 'idle';

    const toolConfirmPending = !!meta?.tool_confirmation_pending;

    const pendingInputCount = Number(meta?.pending_input_count) || 0;

    const backgroundTasksCount = Array.isArray(meta?.background_tasks) ? meta.background_tasks.length : 0;

    const subagentsCount = Array.isArray(meta?.subagents) ? meta.subagents.length : 0;

    const artifactsCount = Array.isArray(meta?.artifacts) ? meta.artifacts.length : 0;

    let vcsDirtyFlag;
    if (typeof meta?.vcs?.dirty === 'boolean') {
      vcsDirtyFlag = meta.vcs.dirty;
    } else {
      vcsDirtyFlag = getGitDirty();
    }
    const vcsDirtyGlyph = vcsDirtyFlag ? '✗' : '✓';
    const vcsDirtyLabel = vcsDirtyFlag
      ? (lang === 'zh-tw' ? '有變更' : (lang === 'jp' ? '変更あり' : 'dirty'))
      : (lang === 'zh-tw' ? '乾淨' : (lang === 'jp' ? 'クリーン' : 'clean'));

    const vcsType = meta?.vcs?.type || 'git';

    const sandboxEnabled = !!meta?.sandbox?.enabled;
    const sandboxAllowNet = !!meta?.sandbox?.allow_network;
    let sandboxStatusVal;
    if (!sandboxEnabled) {
      sandboxStatusVal = lang === 'zh-tw' ? '關閉' : (lang === 'jp' ? 'オフ' : 'off');
    } else if (sandboxAllowNet) {
      sandboxStatusVal = lang === 'zh-tw' ? '啟用（聯網）' : (lang === 'jp' ? 'オン（ネット）' : 'on (net)');
    } else {
      sandboxStatusVal = lang === 'zh-tw' ? '啟用（離線）' : (lang === 'jp' ? 'オン（オフライン）' : 'on (no-net)');
    }

    const cliVersion = meta?.version ? `v${meta.version}` : unknownStr;

    const rawConvId = meta?.conversation_id || '';
    const conversationIdShort = rawConvId ? rawConvId.replace(/-/g, '').slice(0, 8) : unknownStr;

    const defaultAgentStr = lang === 'zh-tw' ? '預設' : (lang === 'jp' ? 'デフォルト' : 'Default');
    let agentProfileName = defaultAgentStr;
    if (typeof meta?.agent === 'string') agentProfileName = meta.agent;
    else if (meta?.agent?.display_name) agentProfileName = meta.agent.display_name;
    else if (meta?.agent?.name) agentProfileName = meta.agent.name;
    else if (meta?.agent?.id) agentProfileName = meta.agent.id;
    else if (meta?.agent?.profile) agentProfileName = meta.agent.profile;

    const i18n = {
      'zh-tw': {
        'model-name': `${WHITE}模型:${RESET} ${getModelColor(fallbackModel)}${BOLD}${fallbackModel}${RESET}`,
        'quota': `${WHITE}API 可用額度:${RESET} ${quotaColor}${BOLD}${quotaVal}${RESET}`,
        'context-used': `${WHITE}Context:${RESET} ${contextColor}${BOLD}${usedPct}${RESET}`,
        'memory-usage': `${WHITE}記憶體:${RESET} ${BLUE}${BOLD}${memUsage}${RESET}`,
        'token-count': `${WHITE}Token:${RESET} ${tokenCount}`,
        'quota-reset-countdown': `${WHITE}API 重置倒數:${RESET} ${BLUE}${BOLD}${countdownVal}${RESET}`,
        'git-branch': `${WHITE}Git 分支: ${BOLD}${gitBranch}${RESET}`,
        'project-path': `${WHITE}專案: ${BOLD}${projectName}${RESET}`,
        'project-full-path': `${WHITE}專案路徑: ${BOLD}${projectFullPath}${RESET}`,
        'plan-tier': `${WHITE}帳號等級: ${BOLD}${planTier}${RESET}`,
        'account-email': `${WHITE}帳號: ${BOLD}${accountEmail}${RESET}`,
        'ai-credits': `${WHITE}AI 點數:${RESET} ${BLUE}${BOLD}${aiCredits}${RESET}`,
        'agent-state': `${WHITE}代理狀態:${RESET} ${getAgentStateColor(agentState)}${BOLD}${agentState}${RESET}`,
        'tool-confirmation': `${WHITE}等你同意:${RESET} ${getToolConfirmColor(toolConfirmPending)}${BOLD}${toolConfirmPending ? '在等你' : '都好了'}${RESET}`,
        'pending-input': `${WHITE}輸入佇列:${RESET} ${getColorByCount(pendingInputCount)}${BOLD}${pendingInputCount}${RESET}`,
        'background-tasks': `${WHITE}背景任務:${RESET} ${getColorByCount(backgroundTasksCount)}${BOLD}${backgroundTasksCount}${RESET}`,
        'subagents': `${WHITE}子代理:${RESET} ${getColorByCount(subagentsCount)}${BOLD}${subagentsCount}${RESET}`,
        'artifacts': `${WHITE}累計產出: ${BOLD}${artifactsCount}${RESET}`,
        'vcs-dirty': `${WHITE}工作區:${RESET} ${getVcsDirtyColor(vcsDirtyFlag)}${BOLD}${vcsDirtyGlyph} ${vcsDirtyLabel}${RESET}`,
        'vcs-type': `${WHITE}版控類型: ${BOLD}${vcsType}${RESET}`,
        'sandbox-status': `${WHITE}沙盒:${RESET} ${getSandboxColor(sandboxEnabled, sandboxAllowNet)}${BOLD}${sandboxStatusVal}${RESET}`,
        'cli-version': `${WHITE}CLI 版本: ${BOLD}${cliVersion}${RESET}`,
        'conversation-id': `${WHITE}對話 ID: ${BOLD}${conversationIdShort}${RESET}`,
        'agent-profile': `${WHITE}使用中代理:${RESET} ${BLUE}${BOLD}${agentProfileName}${RESET}`
      },
      'us': {
        'model-name': `${WHITE}Model:${RESET} ${getModelColor(fallbackModel)}${BOLD}${fallbackModel}${RESET}`,
        'quota': `${WHITE}API Available:${RESET} ${quotaColor}${BOLD}${quotaVal}${RESET}`,
        'context-used': `${WHITE}Context:${RESET} ${contextColor}${BOLD}${usedPct}${RESET}`,
        'memory-usage': `${WHITE}RAM:${RESET} ${BLUE}${BOLD}${memUsage}${RESET}`,
        'token-count': `${WHITE}Tokens:${RESET} ${tokenCount}`,
        'quota-reset-countdown': `${WHITE}API Reset in:${RESET} ${BLUE}${BOLD}${countdownVal}${RESET}`,
        'git-branch': `${WHITE}Git: ${BOLD}${gitBranch}${RESET}`,
        'project-path': `${WHITE}Project: ${BOLD}${projectName}${RESET}`,
        'project-full-path': `${WHITE}Project Path: ${BOLD}${projectFullPath}${RESET}`,
        'plan-tier': `${WHITE}Plan: ${BOLD}${planTier}${RESET}`,
        'account-email': `${WHITE}Account: ${BOLD}${accountEmail}${RESET}`,
        'ai-credits': `${WHITE}AI Credits:${RESET} ${BLUE}${BOLD}${aiCredits}${RESET}`,
        'agent-state': `${WHITE}Agent:${RESET} ${getAgentStateColor(agentState)}${BOLD}${agentState}${RESET}`,
        'tool-confirmation': `${WHITE}Awaiting You:${RESET} ${getToolConfirmColor(toolConfirmPending)}${BOLD}${toolConfirmPending ? 'waiting' : 'all clear'}${RESET}`,
        'pending-input': `${WHITE}Queue:${RESET} ${getColorByCount(pendingInputCount)}${BOLD}${pendingInputCount}${RESET}`,
        'background-tasks': `${WHITE}BG:${RESET} ${getColorByCount(backgroundTasksCount)}${BOLD}${backgroundTasksCount}${RESET}`,
        'subagents': `${WHITE}Subagents:${RESET} ${getColorByCount(subagentsCount)}${BOLD}${subagentsCount}${RESET}`,
        'artifacts': `${WHITE}Cumulative Outputs: ${BOLD}${artifactsCount}${RESET}`,
        'vcs-dirty': `${WHITE}Status:${RESET} ${getVcsDirtyColor(vcsDirtyFlag)}${BOLD}${vcsDirtyGlyph} ${vcsDirtyLabel}${RESET}`,
        'vcs-type': `${WHITE}VCS: ${BOLD}${vcsType}${RESET}`,
        'sandbox-status': `${WHITE}Sandbox:${RESET} ${getSandboxColor(sandboxEnabled, sandboxAllowNet)}${BOLD}${sandboxStatusVal}${RESET}`,
        'cli-version': `${WHITE}CLI: ${BOLD}${cliVersion}${RESET}`,
        'conversation-id': `${WHITE}Conv: ${BOLD}${conversationIdShort}${RESET}`,
        'agent-profile': `${WHITE}Profile:${RESET} ${BLUE}${BOLD}${agentProfileName}${RESET}`
      },
      'jp': {
        'model-name': `${WHITE}モデル:${RESET} ${getModelColor(fallbackModel)}${BOLD}${fallbackModel}${RESET}`,
        'quota': `${WHITE}API 利用可能枠:${RESET} ${quotaColor}${BOLD}${quotaVal}${RESET}`,
        'context-used': `${WHITE}コンテキスト:${RESET} ${contextColor}${BOLD}${usedPct}${RESET}`,
        'memory-usage': `${WHITE}メモリ:${RESET} ${BLUE}${BOLD}${memUsage}${RESET}`,
        'token-count': `${WHITE}トークン数:${RESET} ${tokenCount}`,
        'quota-reset-countdown': `${WHITE}API リセットまで:${RESET} ${BLUE}${BOLD}${countdownVal}${RESET}`,
        'git-branch': `${WHITE}Gitブランチ: ${BOLD}${gitBranch}${RESET}`,
        'project-path': `${WHITE}プロジェクト: ${BOLD}${projectName}${RESET}`,
        'project-full-path': `${WHITE}プロジェクトパス: ${BOLD}${projectFullPath}${RESET}`,
        'plan-tier': `${WHITE}プラン: ${BOLD}${planTier}${RESET}`,
        'account-email': `${WHITE}アカウント: ${BOLD}${accountEmail}${RESET}`,
        'ai-credits': `${WHITE}AI クレジット:${RESET} ${BLUE}${BOLD}${aiCredits}${RESET}`,
        'agent-state': `${WHITE}エージェント状態:${RESET} ${getAgentStateColor(agentState)}${BOLD}${agentState}${RESET}`,
        'tool-confirmation': `${WHITE}ご承認待ち:${RESET} ${getToolConfirmColor(toolConfirmPending)}${BOLD}${toolConfirmPending ? '待機中' : 'すべて完了'}${RESET}`,
        'pending-input': `${WHITE}入力キュー:${RESET} ${getColorByCount(pendingInputCount)}${BOLD}${pendingInputCount}${RESET}`,
        'background-tasks': `${WHITE}バックグラウンドタスク:${RESET} ${getColorByCount(backgroundTasksCount)}${BOLD}${backgroundTasksCount}${RESET}`,
        'subagents': `${WHITE}サブエージェント:${RESET} ${getColorByCount(subagentsCount)}${BOLD}${subagentsCount}${RESET}`,
        'artifacts': `${WHITE}累計成果物: ${BOLD}${artifactsCount}${RESET}`,
        'vcs-dirty': `${WHITE}作業領域:${RESET} ${getVcsDirtyColor(vcsDirtyFlag)}${BOLD}${vcsDirtyGlyph} ${vcsDirtyLabel}${RESET}`,
        'vcs-type': `${WHITE}VCS種別: ${BOLD}${vcsType}${RESET}`,
        'sandbox-status': `${WHITE}サンドボックス:${RESET} ${getSandboxColor(sandboxEnabled, sandboxAllowNet)}${BOLD}${sandboxStatusVal}${RESET}`,
        'cli-version': `${WHITE}CLIバージョン: ${BOLD}${cliVersion}${RESET}`,
        'conversation-id': `${WHITE}会話 ID: ${BOLD}${conversationIdShort}${RESET}`,
        'agent-profile': `${WHITE}エージェントプロファイル:${RESET} ${BLUE}${BOLD}${agentProfileName}${RESET}`
      }
    };

    const activeDict = i18n[lang] || i18n['zh-tw'];

    const lines = [];
    let currentLine = '';
    
    for (let i = 0; i < footerItems.length; i++) {
      const item = footerItems[i];

      // 強制換行符號（規範保留識別碼，允許重複出現以產生額外空行）
      // 注意：連續 n 推入空字串會被 agy CLI 渲染層折疊成單一換行，
      // 故 fallback 推入單一半形空白以保留可見的空白行。
      if (item === 'n' || item === 'newline') {
        if (currentLine !== '') {
          lines.push(currentLine);
          currentLine = '';
        } else {
          lines.push(' ');
        }
        continue;
      }

      let text = activeDict[item];
      if (!text) continue;

      const toAdd = currentLine === '' ? text : ` ${GRAY}│${RESET} ${text}`;
      const toAddPlain = stripAnsi(toAdd);
      const currentPlain = stripAnsi(currentLine);
      
      // 智慧自動換行計算 (以整塊功能為單位換行)
      if (currentLine !== '' && getDisplayWidth(currentPlain) + getDisplayWidth(toAddPlain) > termWidth) {
        lines.push(currentLine);
        currentLine = text;
      } else {
        currentLine += (currentLine === '' ? text : ` ${GRAY}│${RESET} ${text}`);
      }
    }
    if (currentLine !== '') lines.push(currentLine);
    
    console.log(lines.join('\n'));

  } catch (err) {
    try {
      const projectLogDir = join(process.cwd(), '.gemini');
      if (existsSync(projectLogDir)) {
        writeFileSync(join(projectLogDir, 'hook_error.log'), `[${new Date().toISOString()}] ${err.stack || err.message}\\n`, { encoding: 'utf8', flag: 'a' });
      }
    } catch (e) {}
    
    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    console.log(`? for shortcuts | ${fallbackModel}`);
  }
  process.exit(0);
}
main();