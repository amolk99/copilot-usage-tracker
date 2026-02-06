import * as vscode from 'vscode';
import * as https from 'https';

// ══════════════════════════════════════════════════════════════════════
//  Stacked-bar characters  (top row = month, bottom row = copilot)
// ══════════════════════════════════════════════════════════════════════
const BOTH = '█';   // Full block  — both filled
const TOP  = '▀';   // Upper half  — only month filled
const BOT  = '▄';   // Lower half  — only copilot filled
const NONE = '░';   // Light shade — neither filled

// ── State ────────────────────────────────────────────────────────────
let statusItem: vscode.StatusBarItem;
let refreshTimer: ReturnType<typeof setInterval>;
let fetchTimer: ReturnType<typeof setInterval>;

// ══════════════════════════════════════════════════════════════════════
//  Activation
// ══════════════════════════════════════════════════════════════════════

export function activate(ctx: vscode.ExtensionContext) {
  autoResetIfNewMonth(ctx);

  // Single status-bar item — sits right of centre, near Copilot button
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
  statusItem.command = 'copilotUsageTracker.setUsage';
  ctx.subscriptions.push(statusItem);

  // ── Commands ────────────────────────────────────────────────────
  const cmds: [string, () => any][] = [
    ['copilotUsageTracker.setUsage',       () => cmdSetUsage(ctx)],
    ['copilotUsageTracker.incrementUsage', () => cmdIncrement(ctx)],
    ['copilotUsageTracker.resetUsage',     () => cmdReset(ctx)],
    ['copilotUsageTracker.refresh',        () => refresh(ctx)],
    ['copilotUsageTracker.setLimit',       () => cmdSetLimit()],
    ['copilotUsageTracker.fetchUsage',     () => cmdFetchUsage(ctx)],
    ['copilotUsageTracker.loginGitHub',    () => cmdLoginGitHub(ctx)],
  ];
  for (const [id, handler] of cmds) {
    ctx.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // ── React to config changes ─────────────────────────────────────
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('copilotUsageTracker')) { render(ctx); }
    }),
  );

  // ── First render + silent auto-fetch attempt ────────────────────
  refresh(ctx);

  // Refresh display every 60 s (month % ticks forward)
  refreshTimer = setInterval(() => {
    autoResetIfNewMonth(ctx);
    render(ctx);
  }, 60_000);

  // Auto-fetch from GitHub every 15 min
  fetchTimer = setInterval(() => fetchUsageFromGitHub(ctx, true), 15 * 60_000);

  ctx.subscriptions.push(
    { dispose: () => clearInterval(refreshTimer) },
    { dispose: () => clearInterval(fetchTimer) },
  );
}

export function deactivate() {
  clearInterval(refreshTimer);
  clearInterval(fetchTimer);
}

// ══════════════════════════════════════════════════════════════════════
//  Auto-reset on new calendar month
// ══════════════════════════════════════════════════════════════════════

function autoResetIfNewMonth(ctx: vscode.ExtensionContext) {
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth()}`;
  if (ctx.globalState.get<string>('lastResetKey') !== key) {
    ctx.globalState.update('copilotRequestsUsed', 0);
    ctx.globalState.update('lastResetKey', key);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Calculations
// ══════════════════════════════════════════════════════════════════════

function getMonthPercent() {
  const now     = new Date();
  const day     = now.getDate();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { percent: Math.round((day / lastDay) * 100), day, lastDay };
}

function getCopilotData(ctx: vscode.ExtensionContext) {
  const cfg   = vscode.workspace.getConfiguration('copilotUsageTracker');
  const limit = cfg.get<number>('monthlyRequestLimit', 300);
  const used  = ctx.globalState.get<number>('copilotRequestsUsed', 0);
  const pct   = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return { used, limit, percent: pct };
}

// ══════════════════════════════════════════════════════════════════════
//  Stacked-bar rendering
//   Each character column encodes TWO rows:
//     top  = month progress   (▀)
//     bot  = copilot usage    (▄)
//     both = █,  neither = ░
// ══════════════════════════════════════════════════════════════════════

function makeStackedBar(topPct: number, botPct: number, len: number): string {
  const tFill = Math.round((topPct / 100) * len);
  const bFill = Math.round((botPct / 100) * len);
  let bar = '';
  for (let i = 0; i < len; i++) {
    const t = i < tFill;
    const b = i < bFill;
    bar += t && b ? BOTH : t ? TOP : b ? BOT : NONE;
  }
  return bar;
}

function render(ctx: vscode.ExtensionContext) {
  const cfg       = vscode.workspace.getConfiguration('copilotUsageTracker');
  const barLength = cfg.get<number>('barLength', 12);

  const { percent: mPct, day, lastDay } = getMonthPercent();
  const { used, limit, percent: cPct }  = getCopilotData(ctx);

  const bar = makeStackedBar(mPct, cPct, barLength);

  // Compact text: M=month% | C=copilot%
  statusItem.text = `$(graph) ${bar} ${mPct}|${cPct}`;

  // ── Rich markdown tooltip ──────────────────────────────────────
  const status = cPct > mPct
    ? '⚠️ **Over-utilising** — Copilot usage is ahead of month'
    : '✅ **On track** — usage is within month progress';

  const md = new vscode.MarkdownString(
    `**Copilot Usage Tracker**\n\n` +
    `| | Row | Detail | % |\n` +
    `|---|---|---|---|\n` +
    `| ▀ | Month (top) | Day **${day}** / **${lastDay}** | **${mPct}%** |\n` +
    `| ▄ | Copilot (bot) | **${used}** / **${limit}** reqs | **${cPct}%** |\n\n` +
    `${status}\n\n` +
    `---\n` +
    `_Click to set usage manually_\n\n` +
    `[$(sync) Fetch from GitHub](command:copilotUsageTracker.fetchUsage)` +
    ` · [$(sign-in) Sign in](command:copilotUsageTracker.loginGitHub)`,
  );
  md.isTrusted = true;
  statusItem.tooltip = md;

  // Warning background when over-utilising
  statusItem.backgroundColor = cPct > mPct
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;

  statusItem.show();
}

// ══════════════════════════════════════════════════════════════════════
//  GitHub API — auto-fetch premium request usage
// ══════════════════════════════════════════════════════════════════════

function ghGet(path: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'copilot-usage-tracker-vscode',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      res => {
        let body = '';
        res.on('data', d => (body += d));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try   { resolve(JSON.parse(body)); }
            catch { resolve(null); }
          } else {
            resolve(null);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

/**
 * Tries multiple GitHub API strategies to get the current user's
 * premium Copilot request count.  Returns true on success.
 */
async function fetchUsageFromGitHub(
  ctx: vscode.ExtensionContext,
  silent: boolean,
): Promise<boolean> {
  try {
    const session = await vscode.authentication.getSession(
      'github',
      ['read:user', 'read:org'],
      { createIfNone: false },
    );
    if (!session) {
      if (!silent) {
        vscode.window.showWarningMessage(
          'Not signed into GitHub. Use "Copilot Tracker: Sign in to GitHub" first.',
        );
      }
      return false;
    }
    const token = session.accessToken;
    const cfg   = vscode.workspace.getConfiguration('copilotUsageTracker');

    // ── Strategy 1: org-level billing seats ──────────────────────
    const org = cfg.get<string>('githubOrg', '');
    if (org) {
      const seats = await ghGet(
        `/orgs/${encodeURIComponent(org)}/copilot/billing/seats`,
        token,
      );
      if (seats?.seats) {
        const login = session.account.label.toLowerCase();
        const seat  = (seats.seats as any[]).find(
          (s: any) => s.assignee?.login?.toLowerCase() === login,
        );
        if (seat && typeof seat.premium_requests_used === 'number') {
          await ctx.globalState.update('copilotRequestsUsed', seat.premium_requests_used);
          render(ctx);
          if (!silent) {
            vscode.window.showInformationMessage(
              `Copilot usage synced from org: ${seat.premium_requests_used} requests`,
            );
          }
          return true;
        }
      }
    }

    // ── Strategy 2: individual user copilot endpoints ────────────
    for (const p of ['/user/copilot/billing/usage', '/user/copilot']) {
      const data = await ghGet(p, token);
      if (data && typeof data.premium_requests_used === 'number') {
        await ctx.globalState.update('copilotRequestsUsed', data.premium_requests_used);
        render(ctx);
        if (!silent) {
          vscode.window.showInformationMessage(
            `Copilot usage synced: ${data.premium_requests_used} requests`,
          );
        }
        return true;
      }
    }

    if (!silent) {
      const choice = await vscode.window.showWarningMessage(
        'Could not auto-fetch usage. The API may not be available for your account type yet. Use manual entry.',
        'Set Manually',
      );
      if (choice === 'Set Manually') {
        vscode.commands.executeCommand('copilotUsageTracker.setUsage');
      }
    }
    return false;
  } catch {
    if (!silent) {
      vscode.window.showErrorMessage('Failed to contact GitHub API.');
    }
    return false;
  }
}

async function refresh(ctx: vscode.ExtensionContext) {
  await fetchUsageFromGitHub(ctx, true);
  render(ctx);
}

// ══════════════════════════════════════════════════════════════════════
//  Commands
// ══════════════════════════════════════════════════════════════════════

async function cmdSetUsage(ctx: vscode.ExtensionContext) {
  const current = ctx.globalState.get<number>('copilotRequestsUsed', 0);
  const input = await vscode.window.showInputBox({
    prompt: 'Premium Copilot requests used this month',
    value: current.toString(),
    validateInput: v => {
      const n = parseInt(v, 10);
      return isNaN(n) || n < 0 ? 'Enter a non-negative number' : null;
    },
  });
  if (input === undefined) { return; }
  const val = parseInt(input, 10);
  await ctx.globalState.update('copilotRequestsUsed', val);
  render(ctx);
  vscode.window.showInformationMessage(`Copilot usage set to ${val}`);
}

async function cmdIncrement(ctx: vscode.ExtensionContext) {
  const used = ctx.globalState.get<number>('copilotRequestsUsed', 0) + 1;
  await ctx.globalState.update('copilotRequestsUsed', used);
  render(ctx);
}

async function cmdReset(ctx: vscode.ExtensionContext) {
  await ctx.globalState.update('copilotRequestsUsed', 0);
  render(ctx);
  vscode.window.showInformationMessage('Copilot usage reset to 0');
}

async function cmdSetLimit() {
  const cfg     = vscode.workspace.getConfiguration('copilotUsageTracker');
  const current = cfg.get<number>('monthlyRequestLimit', 300);
  const input = await vscode.window.showInputBox({
    prompt: 'Monthly premium request limit',
    value: current.toString(),
    validateInput: v => {
      const n = parseInt(v, 10);
      return isNaN(n) || n <= 0 ? 'Enter a positive number' : null;
    },
  });
  if (input === undefined) { return; }
  await cfg.update('monthlyRequestLimit', parseInt(input, 10), vscode.ConfigurationTarget.Global);
}

async function cmdFetchUsage(ctx: vscode.ExtensionContext) {
  await fetchUsageFromGitHub(ctx, false);
}

async function cmdLoginGitHub(ctx: vscode.ExtensionContext) {
  try {
    const session = await vscode.authentication.getSession(
      'github',
      ['read:user', 'read:org'],
      { createIfNone: true },
    );
    if (session) {
      vscode.window.showInformationMessage(`Signed in as ${session.account.label}`);
      await fetchUsageFromGitHub(ctx, false);
    }
  } catch {
    vscode.window.showErrorMessage('GitHub sign-in failed.');
  }
}
