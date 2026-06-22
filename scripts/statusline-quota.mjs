import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { join, basename } from 'path';
import os from 'os';

// ==========================================
// Constants & UI Styling
// ==========================================
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GRAY = "\x1b[90m";
const WHITE = "";
const BLUE = "\x1b[38;2;87;202;255m";
const GREEN = "\x1b[38;2;92;219;109m";
const YELLOW = "\x1b[38;2;255;212;39m";
const RED = "\x1b[38;2;255;125;175m";

function getColorByPercentage(pct) {
  if (pct >= 50) return GREEN;
  if (pct >= 25) return YELLOW;
  return RED;
}

function getColorByCount(n) {
  if (n === 0) return BLUE;
  if (n <= 2) return GREEN;
  if (n <= 4) return YELLOW;
  return RED;
}

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

function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function getDisplayWidth(str) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    width += str.charCodeAt(i) > 0x7F ? 2 : 1;
  }
  return width;
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

// ==========================================
// System Information Retrieval
// ==========================================
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

// ==========================================
// Initialization & Config Reading
// ==========================================
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

// ==========================================
// Business Logic Helpers
// ==========================================
function triggerQuotaUpdateIfNeeded(cacheInfo) {
  let needUpdate = true;
  if (cacheInfo && Date.now() - (cacheInfo.updatedAt || 0) < 30000) needUpdate = false;

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
}

function resolveModelQuota(fallbackModel, cache) {
  const normModel = normalizeModelName(fallbackModel);
  let modelQuota = null;
  if (cache && cache.models) {
    // 1. Exact match
    if (cache.models[normModel]) {
      modelQuota = cache.models[normModel];
    } else {
      // 2. Substring match
      for (const k in cache.models) {
        if (normModel.includes(k) || k.includes(normModel)) {
          modelQuota = cache.models[k];
          break;
        }
      }
    }
    // 3. Family match
    if (!modelQuota) {
      const families = ['claude', 'gemini', 'gpt'];
      const modelFamily = families.find(f => normModel.includes(f));
      if (modelFamily) {
        for (const k in cache.models) {
          if (k.includes(modelFamily)) {
            if (!modelQuota || cache.models[k].remaining_percentage < modelQuota.remaining_percentage) {
              modelQuota = cache.models[k];
            }
          }
        }
      }
    }
  }
  // 4. Global minimum fallback
  if (!modelQuota && cache && cache.models) {
    const allKeys = Object.keys(cache.models);
    if (allKeys.length > 0) {
      modelQuota = allKeys.reduce((min, k) =>
        cache.models[k].remaining_percentage < min.remaining_percentage ? cache.models[k] : min
      , cache.models[allKeys[0]]);
    }
  }
  return modelQuota || { remaining_percentage: 100, refreshes_in: '' };
}

function calculateContextUsage(meta, conversationId) {
  const contextWindow = meta.context_window || {};
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
  
  return { totalInput, contextSize, usedPctNum };
}

function manageAccountMetaCache(meta) {
  const accountMetaPath = join(os.homedir(), '.gemini', 'tmp', 'account_meta_cache.json');
  let cachedAccount = {};
  try { if (existsSync(accountMetaPath)) cachedAccount = JSON.parse(readFileSync(accountMetaPath, 'utf8')); } catch (e) {}
  
  if (meta && meta.account && (meta.account.email || meta.account.plan_tier || meta.account.ai_credits)) {
    if (meta.account.email) cachedAccount.email = meta.account.email;
    if (meta.account.plan_tier) cachedAccount.planTier = meta.account.plan_tier;
    if (meta.account.ai_credits) cachedAccount.aiCredits = meta.account.ai_credits;
    try { writeFileSync(accountMetaPath, JSON.stringify(cachedAccount), { encoding: 'utf8' }); } catch (e) {}
  }
  return cachedAccount;
}

function extractMetrics(meta, lang, fallbackModel, cache, cachedAccount, quotaInfo, contextInfo) {
  const unknownStr = lang === 'zh-tw' ? '未知' : (lang === 'jp' ? '不明' : 'Unknown');
  const noneStr = lang === 'zh-tw' ? '無' : (lang === 'jp' ? 'なし' : 'N/A');

  // System & Environment
  const rssMem = getCliMemoryMB();
  const memUsage = `${rssMem}MB`;
  const gitBranch = getGitBranch(lang);
  const projectName = basename(process.cwd());
  const projectFullPath = process.cwd();

  // Account
  const planTier = (cache && cache.planTier) ? cache.planTier : (meta?.account?.plan_tier || cachedAccount.planTier || unknownStr);
  const accountEmail = (cache && cache.email) ? cache.email : (meta?.account?.email || cachedAccount.email || unknownStr);
  const aiCredits = (cache && cache.aiCredits) ? cache.aiCredits : (meta?.account?.ai_credits || cachedAccount.aiCredits || noneStr);

  // Quota (grouped: Gemini vs Anthropic/OpenAI, and showing 5hr / weekly quota)
  const isGemini = fallbackModel.toLowerCase().includes('gemini');
  let provider = isGemini ? 'Gemini' : 'Anthropic/OpenAI';

  let quotaPct = 100;
  let weeklyPct = undefined;
  let quotaColor5h = '';
  let quotaColor1w = '';
  let countdownVal = noneStr;
  let countdownVal5h = '';
  let countdownVal1w = '';

  if (meta && meta.quota) {
    const key5h = isGemini ? 'gemini-5h' : '3p-5h';
    const keyWeekly = isGemini ? 'gemini-weekly' : '3p-weekly';
    if (meta.quota[key5h]) {
      quotaPct = meta.quota[key5h].remaining_fraction * 100;
      quotaColor5h = getColorByPercentage(quotaPct);
      const resetSec = meta.quota[key5h].reset_in_seconds;
      if (resetSec !== undefined) {
        const h = Math.floor(resetSec / 3600);
        const m = Math.floor((resetSec % 3600) / 60);
        countdownVal5h = h > 0 ? `${h}h ${m}m` : `${m}m`;
      }
    }
    if (meta.quota[keyWeekly]) {
      weeklyPct = meta.quota[keyWeekly].remaining_fraction * 100;
      quotaColor1w = getColorByPercentage(weeklyPct);
      const wResetSec = meta.quota[keyWeekly].reset_in_seconds;
      if (wResetSec !== undefined) {
        const d = Math.floor(wResetSec / 86400);
        const h = Math.floor((wResetSec % 86400) / 3600);
        countdownVal1w = d > 0 ? `${d}d ${h}h` : `${h}h`;
      }
    }
    
    if (countdownVal5h && countdownVal1w) {
      countdownVal = `(5h) ${countdownVal5h} / (1w) ${countdownVal1w}`;
    } else if (countdownVal5h) {
      countdownVal = `(5h) ${countdownVal5h}`;
    } else if (countdownVal1w) {
      countdownVal = `(1w) ${countdownVal1w}`;
    }
  } else {
    quotaPct = quotaInfo.remaining_percentage !== undefined ? quotaInfo.remaining_percentage : 100;
    weeklyPct = quotaInfo.weekly_remaining_percentage;
    quotaColor5h = getColorByPercentage(quotaPct);
    if(weeklyPct !== undefined) quotaColor1w = getColorByPercentage(weeklyPct);
    countdownVal = quotaInfo.refreshes_in || noneStr;
  }

  const quotaColor = quotaColor5h;
  let quotaLabel = lang === 'zh-tw' ? `${provider} 額度` : (lang === 'jp' ? `${provider} 枠` : `${provider} Quota`);
  const weeklyStr = weeklyPct !== undefined ? ` / ${quotaColor1w}(1w) ${Math.round(weeklyPct)}%${RESET}` : '';
  let quotaVal = `${quotaColor5h}(5h) ${Math.round(quotaPct)}%${RESET}${weeklyStr}`;

  // Context
  const remainCtx = Math.max(0, 100 - contextInfo.usedPctNum);
  const contextColor = getColorByPercentage(remainCtx);
  const usedPct = `${contextInfo.usedPctNum.toFixed(1)}%`;
  const tokenCount = `${contextColor}${formatTokens(contextInfo.totalInput)}${RESET} / ${BLUE}${formatTokens(contextInfo.contextSize)}${RESET}`;

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const systemTimeVal = `${hours}:${minutes}`;

  // Agent State
  const agentState = meta?.agent_state || 'idle';
  const toolConfirmPending = !!meta?.tool_confirmation_pending;
  const pendingInputCount = Number(meta?.pending_input_count) || 0;
  const backgroundTasksCount = Array.isArray(meta?.background_tasks) ? meta.background_tasks.length : 0;
  const subagentsCount = Array.isArray(meta?.subagents) ? meta.subagents.length : 0;
  const artifactsCount = Array.isArray(meta?.artifacts) ? meta.artifacts.length : 0;

  let agentProfileName = lang === 'zh-tw' ? '預設' : (lang === 'jp' ? 'デフォルト' : 'Default');
  if (typeof meta?.agent === 'string') agentProfileName = meta.agent;
  else if (meta?.agent?.display_name) agentProfileName = meta.agent.display_name;
  else if (meta?.agent?.name) agentProfileName = meta.agent.name;
  else if (meta?.agent?.id) agentProfileName = meta.agent.id;
  else if (meta?.agent?.profile) agentProfileName = meta.agent.profile;

  // VCS & Sandbox
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

  // CLI
  const cliVersion = meta?.version ? `v${meta.version}` : unknownStr;
  const rawConvId = meta?.conversation_id || '';
  const conversationIdShort = rawConvId ? rawConvId.replace(/-/g, '').slice(0, 8) : unknownStr;

  return {
    fallbackModel, quotaColor, quotaVal, quotaLabel, contextColor, usedPct, memUsage, tokenCount,
    countdownVal, gitBranch, projectName, projectFullPath, planTier, accountEmail, aiCredits,
    agentState, toolConfirmPending, pendingInputCount, backgroundTasksCount, subagentsCount,
    artifactsCount, vcsDirtyFlag, vcsDirtyGlyph, vcsDirtyLabel, vcsType, sandboxEnabled,
    sandboxAllowNet, sandboxStatusVal, cliVersion, conversationIdShort, agentProfileName, systemTimeVal
  };
}

function buildI18nDict(lang, m) {
  const dicts = {
    'zh-tw': {
      'model-name': `模型:\x1b[0m ${getModelColor(m.fallbackModel)}\x1b[1m${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${m.quotaLabel}:\x1b[0m ${m.quotaColor}\x1b[1m${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}Context:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}記憶體:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}Token:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}API 重置倒數:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'git-branch': `Git 分支: \x1b[1m${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}專案: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `專案路徑: \x1b[1m${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}帳號等級: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}帳號: ${BOLD}${m.accountEmail}${RESET}`,
      'ai-credits': `${WHITE}AI 點數:${RESET} ${BLUE}${BOLD}${m.aiCredits}${RESET}`,
      'agent-state': `${WHITE}代理狀態:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}等你同意:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '在等你' : '都好了'}${RESET}`,
      'pending-input': `${WHITE}輸入佇列:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}背景任務:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}子代理:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}累計產出: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}工作區:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}版控類型: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}沙盒:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `CLI 版本: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `對話 ID: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `使用中代理: ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'system-time': `時間: ${BOLD}${m.systemTimeVal}${RESET}`
    },
    'us': {
      'model-name': `Model:\x1b[0m ${getModelColor(m.fallbackModel)}\x1b[1m${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${m.quotaLabel}:\x1b[0m ${m.quotaColor}\x1b[1m${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}Context:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}RAM:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}Tokens:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}API Reset in:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'git-branch': `Git: \x1b[1m${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}Project: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `Project Path: \x1b[1m${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}Plan: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}Account: ${BOLD}${m.accountEmail}${RESET}`,
      'ai-credits': `${WHITE}AI Credits:${RESET} ${BLUE}${BOLD}${m.aiCredits}${RESET}`,
      'agent-state': `${WHITE}Agent:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}Awaiting You:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? 'waiting' : 'all clear'}${RESET}`,
      'pending-input': `${WHITE}Queue:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}BG:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}Subagents:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}Cumulative Outputs: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}Status:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}VCS: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}Sandbox:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `CLI: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `Conv: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `Profile: ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'system-time': `Time: ${BOLD}${m.systemTimeVal}${RESET}`
    },
    'jp': {
      'model-name': `モデル:\x1b[0m ${getModelColor(m.fallbackModel)}\x1b[1m${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${m.quotaLabel}:\x1b[0m ${m.quotaColor}\x1b[1m${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}コンテキスト:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}メモリ:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}トークン数:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}API リセットまで:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'git-branch': `Gitブランチ: \x1b[1m${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}プロジェクト: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `プロジェクトパス: \x1b[1m${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}プラン: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}アカウント: ${BOLD}${m.accountEmail}${RESET}`,
      'ai-credits': `${WHITE}AI クレジット:${RESET} ${BLUE}${BOLD}${m.aiCredits}${RESET}`,
      'agent-state': `${WHITE}エージェント状態:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}ご承認待ち:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '待機中' : 'すべて完了'}${RESET}`,
      'pending-input': `${WHITE}入力キュー:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}バックグラウンドタスク:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}サブエージェント:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}累計成果物: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}作業領域:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}VCS種別: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}サンドボックス:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `CLIバージョン: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `会話 ID: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `エージェントプロファイル: ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'system-time': `時間: ${BOLD}${m.systemTimeVal}${RESET}`
    }
  };
  return dicts[lang] || dicts['zh-tw'];
}

// ==========================================
// Theme and Styles Configuration (Nord)
// ==========================================
const NORD = {
  nord0: '46;52;64',     // #2E3440 (Polar Night)
  nord1: '59;66;82',     // #3B4252
  nord2: '67;76;94',     // #434C5E
  nord3: '76;86;106',    // #4C566A
  nord4: '216;222;233',  // #D8DEE9 (Snow Storm)
  nord5: '229;233;240',  // #E5E9F0
  nord6: '236;239;244',  // #ECEFF4
  nord7: '143;188;187',  // #8FBCBB (Frost - teal)
  nord8: '136;192;208',  // #88C0D0 (Frost - ice blue)
  nord9: '129;161;193',  // #81A1C1 (Frost - sky blue)
  nord10: '94;129;172',   // #5E81AC (Frost - royal blue)
  nord11: '191;97;106',  // #BF616A (Aurora - red)
  nord12: '208;135;112',  // #D08770 (Aurora - orange)
  nord13: '235;203;139',  // #EBCB8B (Aurora - yellow)
  nord14: '163;190;140',  // #A3BE8C (Aurora - green)
  nord15: '180;142;173'   // #B48EAD (Aurora - purple)
};

function getSegmentStyle(item, m) {
  let bg = NORD.nord1;
  let fg = NORD.nord6;
  let icon = '';

  switch (item) {
    case 'model-name':
      bg = NORD.nord13; // Yellow
      fg = NORD.nord0; // Dark text
      icon = '❖ ';
      break;
    case 'agent-profile':
      bg = NORD.nord7;  // Teal (nord7)
      fg = NORD.nord0;
      icon = ' ';
      break;
    case 'agent-state':
      const s = (m.agentState || '').toLowerCase();
      if (s.includes('error') || s.includes('fail')) {
        bg = NORD.nord11; // Red
        fg = NORD.nord6;
      } else if (s.includes('busy') || s.includes('run') || s.includes('think')) {
        bg = NORD.nord13; // Yellow
        fg = NORD.nord0;
      } else {
        bg = NORD.nord14; // Green
        fg = NORD.nord0;
      }
      icon = ' ';
      break;
    case 'sandbox-status':
      if (!m.sandboxEnabled) {
        bg = NORD.nord11;
        fg = NORD.nord6;
      } else if (m.sandboxAllowNet) {
        bg = NORD.nord13;
        fg = NORD.nord0;
      } else {
        bg = NORD.nord10; // Blue (nord10)
        fg = NORD.nord6;
      }
      icon = ' ';
      break;
    case 'context-used':
      bg = NORD.nord10; // Deep blue
      fg = NORD.nord6; // Light text
      icon = '≡ ';
      break;
    case 'token-count':
      bg = NORD.nord3; // Medium gray (nord3)
      fg = NORD.nord4; // Light text
      icon = ' ';
      break;
    case 'artifacts':
      bg = NORD.nord2; // Dark gray (nord2)
      fg = NORD.nord6;
      icon = ' ';
      break;
    case 'account-email':
      bg = NORD.nord7; // Teal
      fg = NORD.nord0; // Dark text
      icon = ' ';
      break;
    case 'plan-tier':
      bg = NORD.nord15; // Purple
      fg = NORD.nord4;
      icon = ' ';
      break;
    case 'system-time':
      bg = NORD.nord15; // Purple
      fg = NORD.nord0; // Dark text
      icon = ' ';
      break;
    case 'quota':
      bg = NORD.nord3; // Medium gray
      fg = NORD.nord4; // Light text
      icon = ' ';
      break;
    case 'quota-reset-countdown':
      bg = NORD.nord2; // Dark gray
      fg = NORD.nord4; // Light text
      icon = ' ';
      break;
    case 'ai-credits':
      bg = NORD.nord1; // Dark polar night
      fg = NORD.nord4; // Light text
      icon = ' ';
      break;
    case 'tool-confirmation':
      if (m.toolConfirmPending) {
        bg = NORD.nord13;
        fg = NORD.nord0;
      } else {
        bg = NORD.nord14;
        fg = NORD.nord0;
      }
      icon = ' ';
      break;
    case 'pending-input':
      if (m.pendingInputCount > 0) {
        bg = NORD.nord12;
        fg = NORD.nord0;
      } else {
        bg = NORD.nord1; // Dark polar night (nord1)
        fg = NORD.nord4;
      }
      icon = ' ';
      break;
    case 'background-tasks':
      if (m.backgroundTasksCount > 0) {
        bg = NORD.nord12;
        fg = NORD.nord0;
      } else {
        bg = NORD.nord2; // Medium dark (nord2) - alternate with pending-input
        fg = NORD.nord4;
      }
      icon = ' ';
      break;
    case 'subagents':
      if (m.subagentsCount > 0) {
        bg = NORD.nord12;
        fg = NORD.nord0;
      } else {
        bg = NORD.nord3; // Medium gray (nord3) - alternate
        fg = NORD.nord4;
      }
      icon = ' ';
      break;
    case 'project-path':
      bg = NORD.nord8; // Ice Blue
      fg = NORD.nord0; // Dark text
      icon = ' ';
      break;
    case 'project-full-path':
      bg = NORD.nord8; // Ice Blue (nord8)
      fg = NORD.nord0;
      icon = ' ';
      break;
    case 'vcs-type':
      bg = NORD.nord2; // Medium dark (nord2)
      fg = NORD.nord4;
      icon = ' ';
      break;
    case 'git-branch':
      bg = NORD.nord7; // Teal
      fg = NORD.nord0; // Dark text
      icon = ' ';
      break;
    case 'vcs-dirty':
      if (m.vcsDirtyFlag) {
        bg = NORD.nord11;
        fg = NORD.nord6;
      } else {
        bg = NORD.nord14;
        fg = NORD.nord0;
      }
      icon = ' ';
      break;
    case 'memory-usage':
      bg = NORD.nord10; // Royal Blue (nord10) - highlight RAM metrics
      fg = NORD.nord6;
      icon = ' ';
      break;
    case 'cli-version':
      bg = NORD.nord0; // Deep polar night (nord0) - subtle details
      fg = NORD.nord4;
      icon = ' ';
      break;
    case 'conversation-id':
      bg = NORD.nord0; // Deep polar night (nord0) - subtle details
      fg = NORD.nord4;
      icon = ' ';
      break;
  }

  return {
    bgCode: `\x1b[48;2;${bg}m`,
    fgCode: `\x1b[38;2;${fg}m`,
    sepCode: `\x1b[38;2;${bg}m`,
    icon
  };
}

function renderStatusLine(footerItems, activeDict, metrics, styleType, termWidth) {
  const lines = [];
  let currentLine = [];
  let currentLineWidth = 0;

  for (let i = 0; i < footerItems.length; i++) {
    const item = footerItems[i];
    if (item === 'n' || item === 'newline') {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
      } else {
        lines.push([{ type: 'newline' }]);
      }
      continue;
    }

    const rawText = activeDict[item] || '';
    const text = stripAnsi(rawText);
    if (!text) continue;

    const style = getSegmentStyle(item, metrics);

    // Calculate display width
    let segmentWidth = 0;
    if (styleType === 'classic' || styleType === 'flat') {
      // Classic: " text " plus separator " │ "
      segmentWidth = getDisplayWidth(text) + (currentLine.length > 0 ? 3 : 0);
    } else if (styleType === 'powerline') {
      // Powerline: " icon text " plus ""
      const content = ` ${style.icon}${text} `;
      segmentWidth = getDisplayWidth(content) + 1; // +1 for 
    } else if (styleType === 'capsule' || styleType === 'colorful') {
      // Capsule/Colorful: flat ends,  in between
      const content = ` ${style.icon}${text} `;
      segmentWidth = getDisplayWidth(content) + 1; // Content + 1 (for )
    }

    if (currentLine.length > 0 && currentLineWidth + segmentWidth > termWidth) {
      lines.push(currentLine);
      currentLine = [{ item, text, rawText, style, width: segmentWidth }];
      currentLineWidth = segmentWidth;
    } else {
      currentLine.push({ item, text, rawText, style, width: segmentWidth });
      currentLineWidth += segmentWidth;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  const outputLines = lines.map(lineItems => {
    if (lineItems.length === 1 && lineItems[0].type === 'newline') {
      return '';
    }

    let lineStr = '';

    if (styleType === 'classic' || styleType === 'flat') {
      const segments = lineItems.map(seg => activeDict[seg.item]);
      return segments.join(` ${GRAY}│${RESET} `);
    }

    if (styleType === 'powerline') {
      for (let j = 0; j < lineItems.length; j++) {
        const seg = lineItems[j];
        const nextSeg = j + 1 < lineItems.length ? lineItems[j + 1] : null;
        
        const segmentContent = ` ${seg.style.icon}${seg.text} `;
        const nextBgCode = nextSeg ? nextSeg.style.bgCode : '\x1b[49m'; // Reset background for end of line
        
        const sep = `${nextBgCode}${seg.style.sepCode}`;
        lineStr += `${seg.style.bgCode}${seg.style.fgCode}${segmentContent}${sep}`;
      }
      return lineStr + RESET;
    }

    if (styleType === 'colorful') {
      for (let j = 0; j < lineItems.length; j++) {
        const seg = lineItems[j];
        const nextSeg = j + 1 < lineItems.length ? lineItems[j + 1] : null;
        const segmentContent = ` ${seg.style.icon}${seg.text} `;
        
        // Render content block
        lineStr += `${seg.style.bgCode}${seg.style.fgCode}${segmentContent}`;
        
        // Connect segments with  inside, flat edges at outer sides
        if (nextSeg) {
          lineStr += `${nextSeg.style.bgCode}${seg.style.sepCode}`;
        }
      }
      return lineStr + RESET;
    }

    return '';
  });

  console.log(outputLines.join('\n'));
}

// ==========================================
// Main Entry
// ==========================================
async function main() {
  if (process.env.DISABLE_QUOTA_HOOK) process.exit(0);
  let meta = {};

  try {
    const stdinStr = await readStdin();
    try { if (stdinStr.trim()) meta = JSON.parse(stdinStr); } catch (e) {}

    const settings = getSettings();
    const termWidth = Math.max(40, (meta?.terminal_width || process.stdout.columns || 80) - 15);
    
    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    
    // 退讓模式
    if (!settings?.ui?.footer?.items) {
      const leftText = '? for shortcuts';
      const rightText = fallbackModel;
      const spacesCount = Math.max(1, termWidth - getDisplayWidth(leftText) - getDisplayWidth(rightText) - 1);
      console.log(`${leftText}${' '.repeat(spacesCount)}${rightText}`);
      process.exit(0);
    }
    
    const lang = settings?.ui?.language || 'zh-tw';
    const footerItems = settings.ui.footer.items;
    const conversationId = meta?.conversation_id || 'default';
    
    // 讀取快取並觸發更新
    const cachePath = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
    let cache = null;
    try { if (existsSync(cachePath)) cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch (e) {}
    triggerQuotaUpdateIfNeeded(cache);

    // 解析核心資料
    const quotaInfo = resolveModelQuota(fallbackModel, cache);
    const contextInfo = calculateContextUsage(meta, conversationId);
    const cachedAccount = manageAccountMetaCache(meta);

    // 格式化指標並繪製
    const metrics = extractMetrics(meta, lang, fallbackModel, cache, cachedAccount, quotaInfo, contextInfo);
    const activeDict = buildI18nDict(lang, metrics);
    const styleType = settings?.ui?.footer?.style || 'classic';
    renderStatusLine(footerItems, activeDict, metrics, styleType, termWidth);

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