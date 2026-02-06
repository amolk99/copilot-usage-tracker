# Copilot Usage Tracker

A single compact **stacked progress bar** in the VS Code status bar that shows your **month progress** vs **Copilot premium request usage** at a glance.

```
$(graph) ████▀▀░▄░░░░ 50|33
         ────────────
         ▀ = month only (top row)
         ▄ = copilot only (bottom row)
         █ = both filled
         ░ = neither
```

The two values after the bar are `month% | copilot%`.  
If the copilot bar is ahead of the month bar → you're **over-utilising** and a ⚠️ warning background appears.

## How it works

Each character position encodes **two rows** using Unicode half-block characters:

| Char | Meaning |
|------|---------|
| `▀` | **Top only** — month has progressed past this point, copilot hasn't |
| `▄` | **Bottom only** — copilot usage has reached this point, month hasn't |
| `█` | **Both** — both have reached this point |
| `░` | **Neither** — empty space ahead |

This gives you two thin horizontal bars stacked vertically in a single line — easy to compare at a glance with any VS Code theme (uses default text colour, no special colours needed).

## Auto-fetching from GitHub

The extension tries to automatically pull your premium request count from GitHub:

1. **Org-level** — if you set `copilotUsageTracker.githubOrg`, it fetches from `/orgs/{org}/copilot/billing/seats` and finds your seat
2. **Individual** — tries `/user/copilot/billing/usage` and `/user/copilot` endpoints

To enable auto-fetch:
- Run **Copilot Tracker: Sign in to GitHub** from the Command Palette
- (Optional) Set your org name in settings

If the API isn't available for your account type, you can always set usage manually — click the bar or use the Command Palette.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `copilotUsageTracker.monthlyRequestLimit` | `300` | Your monthly premium request allowance |
| `copilotUsageTracker.barLength` | `12` | Character width of the stacked bar (5–20) |
| `copilotUsageTracker.githubOrg` | `""` | GitHub org name for org-level API fetching |

## Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) → search **Copilot Tracker**:

| Command | Description |
|---------|-------------|
| **Set Premium Requests Used** | Enter your current usage count manually |
| **Increment Premium Requests (+1)** | Bump the counter by one |
| **Reset Premium Requests to 0** | Zero out the counter |
| **Set Monthly Request Limit** | Change your plan's limit |
| **Fetch Usage from GitHub** | Manually trigger a GitHub API sync |
| **Sign in to GitHub** | Authenticate to enable auto-fetching |
| **Refresh Bars** | Force a re-render |

## Features

- **Stacked vertical bars** — compare month vs copilot at a glance  
- **Theme-friendly** — uses default status bar text colour (white on dark, black on light)  
- **Warning highlight** — yellow background when copilot is ahead of month  
- **Auto-resets** counter when a new month begins  
- **Auto-fetches** from GitHub API every 15 minutes (when signed in)  
- **Persists** across VS Code sessions (stored in globalState)  
- **Rich tooltip** — hover for full details table and quick action links

## Where to find your usage

Visit [github.com/settings/copilot](https://github.com/settings/copilot) → look for "Premium requests" to see your current count and enter it manually if auto-fetch isn't available.

## Development

```bash
npm install
npm run compile   # or: npm run watch
# Press F5 to launch the Extension Development Host
```

## Publishing to VS Code Marketplace

```bash
# 1. Install the publishing tool
npm install -g @vscode/vsce

# 2. Create a publisher at https://marketplace.visualstudio.com/manage
#    (sign in with a Microsoft account)

# 3. Create a Personal Access Token (PAT) at https://dev.azure.com
#    → User Settings → Personal Access Tokens
#    → Scopes: Marketplace > Manage

# 4. Login with your publisher name
vsce login <your-publisher-name>

# 5. Package and publish
vsce publish
```

## License

MIT
