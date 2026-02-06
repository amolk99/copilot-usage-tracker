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
    ['copilotUsageTracker.resetUsage',     () => cmdReset(ctx)],
    ['copilotUsageTracker.refresh',        () => refresh(ctx)],
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
    ctx.globalState.update('copilotPercentUsed', 0);
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

function getCopilotPercent(ctx: vscode.ExtensionContext): number {
  return Math.min(100, Math.max(0, ctx.globalState.get<number>('copilotPercentUsed', 0)));
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
  const cPct = getCopilotPercent(ctx);

  const bar = makeStackedBar(mPct, cPct, barLength);

  // Compact text: M=month% | C=copilot%
  statusItem.text = `$(graph) ${bar} ${mPct}|${cPct}`;

  // ── Rich markdown tooltip ──────────────────────────────────────
  const status = cPct > mPct
    ? '⚠️ **Over-utilising** — Copilot usage is ahead of month'
    : '✅ **On track** — usage is within month progress';

  const md = new vscode.MarkdownString(
    `**Copilot Usage Tracker**\n\n` +
    `| | Row | % Used |\n` +
    `|---|---|---|\n` +
    `| ▀ | Month (top) — Day ${day}/${lastDay} | **${mPct}%** |\n` +
    `| ▄ | Copilot (bottom) | **${cPct}%** |\n\n` +
    `${status}\n\n` +
    `---\n` +
    `_Click to set usage % · check [GitHub settings](https://github.com/settings/copilot)_\n\n` +
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
 * Extract a percentage from various possible API response shapes.
 * Handles: { percentage_used }, { premium_requests_percentage },
 *          { premium_requests_used, premium_requests_limit }, etc.
 */
function extractPercent(data: any): number | null {
  // Direct percentage fields
  if (typeof data.percentage_used === 'number') { return Math.round(data.percentage_used); }
  if (typeof data.premium_requests_percentage === 'number') { return Math.round(data.premium_requests_percentage); }

  // Compute from used/limit
  if (typeof data.premium_requests_used === 'number' && typeof data.premium_requests_limit === 'number' && data.premium_requests_limit > 0) {
    return Math.round((data.premium_requests_used / data.premium_requests_limit) * 100);
  }

  return null;
}

/**
 * Tries multiple GitHub API strategies to get the current user's
 * premium Copilot request percentage.  Returns true on success.
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
        if (seat) {
          const pct = extractPercent(seat);
          if (pct !== null) {
            await ctx.globalState.update('copilotPercentUsed', pct);
            render(ctx);
            if (!silent) {
              vscode.window.showInformationMessage(`Copilot usage synced from org: ${pct}%`);
            }
            return true;
          }
        }
      }
    }

    // ── Strategy 2: individual user copilot endpoints ────────────
    for (const p of ['/user/copilot/billing/usage', '/user/copilot']) {
      const data = await ghGet(p, token);
      if (data) {
        const pct = extractPercent(data);
        if (pct !== null) {
          await ctx.globalState.update('copilotPercentUsed', pct);
          render(ctx);
          if (!silent) {
            vscode.window.showInformationMessage(`Copilot usage synced: ${pct}%`);
          }
          return true;
        }
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
  const current = ctx.globalState.get<number>('copilotPercentUsed', 0);
  const input = await vscode.window.showInputBox({
    prompt: 'Copilot premium requests used (%) — check github.com/settings/copilot',
    value: current.toString(),
    placeHolder: '0–100',
    validateInput: v => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0 || n > 100) { return 'Enter a number between 0 and 100'; }
      return null;
    },
  });
  if (input === undefined) { return; }
  const val = parseInt(input, 10);
  await ctx.globalState.update('copilotPercentUsed', val);
  render(ctx);
  vscode.window.showInformationMessage(`Copilot usage set to ${val}%`);
}

async function cmdReset(ctx: vscode.ExtensionContext) {
  await ctx.globalState.update('copilotPercentUsed', 0);
  render(ctx);
  vscode.window.showInformationMessage('Copilot usage reset to 0%');
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
