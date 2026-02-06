import * as vscode from 'vscode';

// ── Unicode bar characters ──────────────────────────────────────────
const FILLED = '█';
const EMPTY   = '░';

// ── State ───────────────────────────────────────────────────────────
let monthItem: vscode.StatusBarItem;
let copilotItem: vscode.StatusBarItem;
let timer: ReturnType<typeof setInterval>;

// ════════════════════════════════════════════════════════════════════
//  Activation
// ════════════════════════════════════════════════════════════════════

export function activate(context: vscode.ExtensionContext) {

  // Reset counter when the calendar month rolls over
  autoResetIfNewMonth(context);

  // ── Status-bar items (Right-aligned, adjacent priorities) ──────
  //   Higher priority → further LEFT inside the right section,
  //   so monthItem (201) sits just left of copilotItem (200).
  monthItem   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 201);
  copilotItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);

  // ── Commands ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotUsageTracker.setUsage',       () => cmdSetUsage(context)),
    vscode.commands.registerCommand('copilotUsageTracker.incrementUsage', () => cmdIncrement(context)),
    vscode.commands.registerCommand('copilotUsageTracker.resetUsage',     () => cmdReset(context)),
    vscode.commands.registerCommand('copilotUsageTracker.refresh',        () => updateBars(context)),
    vscode.commands.registerCommand('copilotUsageTracker.setLimit',       () => cmdSetLimit()),
  );

  // ── React to setting changes ──────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('copilotUsageTracker')) {
        updateBars(context);
      }
    }),
  );

  // ── Disposables ───────────────────────────────────────────────
  context.subscriptions.push(monthItem, copilotItem);

  // ── First render + periodic refresh (every 60 s) ──────────────
  updateBars(context);
  timer = setInterval(() => {
    autoResetIfNewMonth(context);
    updateBars(context);
  }, 60_000);

  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {
  if (timer) { clearInterval(timer); }
}

// ════════════════════════════════════════════════════════════════════
//  Auto-reset on new month
// ════════════════════════════════════════════════════════════════════

function autoResetIfNewMonth(ctx: vscode.ExtensionContext) {
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth()}`;
  if (ctx.globalState.get<string>('lastResetKey') !== key) {
    ctx.globalState.update('copilotRequestsUsed', 0);
    ctx.globalState.update('lastResetKey', key);
  }
}

// ════════════════════════════════════════════════════════════════════
//  Calculations
// ════════════════════════════════════════════════════════════════════

function getMonthPercent(): { percent: number; day: number; lastDay: number } {
  const now     = new Date();
  const day     = now.getDate();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { percent: Math.round((day / lastDay) * 100), day, lastDay };
}

function getCopilotData(ctx: vscode.ExtensionContext) {
  const cfg   = vscode.workspace.getConfiguration('copilotUsageTracker');
  const limit = cfg.get<number>('monthlyRequestLimit', 300);
  const used  = ctx.globalState.get<number>('copilotRequestsUsed', 0);
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return { used, limit, percent };
}

// ════════════════════════════════════════════════════════════════════
//  Bar rendering
// ════════════════════════════════════════════════════════════════════

function makeBar(percent: number, length: number): string {
  const filled = Math.round((percent / 100) * length);
  return FILLED.repeat(filled) + EMPTY.repeat(length - filled);
}

function updateBars(ctx: vscode.ExtensionContext) {
  const cfg       = vscode.workspace.getConfiguration('copilotUsageTracker');
  const barLength = cfg.get<number>('barLength', 10);

  // ── Month bar (green) ─────────────────────────────────────────
  const { percent: mPct, day, lastDay } = getMonthPercent();
  monthItem.text    = `$(calendar) ${makeBar(mPct, barLength)} ${mPct}%`;
  monthItem.tooltip = new vscode.MarkdownString(
    `**Month Progress**\n\nDay **${day}** of **${lastDay}**\n\n${mPct}% of the month has passed`,
  );
  monthItem.color   = new vscode.ThemeColor('charts.green');
  monthItem.command = 'copilotUsageTracker.refresh';
  monthItem.show();

  // ── Copilot bar (red) ─────────────────────────────────────────
  const { used, limit, percent: cPct } = getCopilotData(ctx);
  copilotItem.text    = `$(zap) ${makeBar(cPct, barLength)} ${cPct}%`;

  const status = cPct > mPct
    ? '⚠️ **Over-utilising** — usage is ahead of month progress'
    : '✅ **On track** — usage is within month progress';

  copilotItem.tooltip = new vscode.MarkdownString(
    `**Copilot Premium Requests**\n\n` +
    `Used **${used}** of **${limit}**  (${cPct}%)\n\n` +
    `${status}\n\n` +
    `_Click to update usage count_`,
  );
  copilotItem.color   = new vscode.ThemeColor('charts.red');
  copilotItem.command = 'copilotUsageTracker.setUsage';

  // Highlight with warning background when over-utilising
  copilotItem.backgroundColor = cPct > mPct
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;

  copilotItem.show();
}

// ════════════════════════════════════════════════════════════════════
//  Commands
// ════════════════════════════════════════════════════════════════════

async function cmdSetUsage(ctx: vscode.ExtensionContext) {
  const current = ctx.globalState.get<number>('copilotRequestsUsed', 0);
  const input = await vscode.window.showInputBox({
    prompt: 'Enter the number of premium Copilot requests used this month',
    value: current.toString(),
    validateInput: v => {
      const n = parseInt(v, 10);
      return isNaN(n) || n < 0 ? 'Enter a valid non-negative number' : null;
    },
  });
  if (input === undefined) { return; }
  const val = parseInt(input, 10);
  await ctx.globalState.update('copilotRequestsUsed', val);
  updateBars(ctx);
  vscode.window.showInformationMessage(`Copilot usage set to ${val}`);
}

async function cmdIncrement(ctx: vscode.ExtensionContext) {
  const used = ctx.globalState.get<number>('copilotRequestsUsed', 0) + 1;
  await ctx.globalState.update('copilotRequestsUsed', used);
  updateBars(ctx);
}

async function cmdReset(ctx: vscode.ExtensionContext) {
  await ctx.globalState.update('copilotRequestsUsed', 0);
  updateBars(ctx);
  vscode.window.showInformationMessage('Copilot usage counter reset to 0');
}

async function cmdSetLimit() {
  const cfg     = vscode.workspace.getConfiguration('copilotUsageTracker');
  const current = cfg.get<number>('monthlyRequestLimit', 300);
  const input = await vscode.window.showInputBox({
    prompt: 'Enter your monthly premium Copilot request limit',
    value: current.toString(),
    validateInput: v => {
      const n = parseInt(v, 10);
      return isNaN(n) || n <= 0 ? 'Enter a positive number' : null;
    },
  });
  if (input === undefined) { return; }
  await cfg.update('monthlyRequestLimit', parseInt(input, 10), vscode.ConfigurationTarget.Global);
}
