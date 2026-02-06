# Copilot Usage Tracker

Two tiny progress bars in the VS Code status bar that let you see at a glance whether you're **under-** or **over-utilising** your GitHub Copilot premium requests for the month.

| Bar | Colour | What it shows |
|-----|--------|---------------|
| 📅 Month | 🟩 Green | Percentage of the calendar month that has elapsed |
| ⚡ Copilot | 🟥 Red | Percentage of your monthly premium request quota used |

> If the red bar is ahead of the green bar you're burning through requests faster than the month is passing — a warning highlight appears automatically.

## Screenshot (concept)

```
$(calendar) ████████░░ 80%   $(zap) ██████░░░░ 60%
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `copilotUsageTracker.monthlyRequestLimit` | `300` | Your plan's monthly premium request allowance |
| `copilotUsageTracker.barLength` | `10` | Character width of each bar (5–20) |

## Commands

Open the Command Palette (`Cmd+Shift+P`) and search for **Copilot Tracker**:

- **Set Premium Requests Used** — enter your current usage (check [github.com/settings/copilot](https://github.com/settings/copilot))
- **Increment Premium Requests (+1)** — bump the counter by one
- **Reset Premium Requests to 0** — zero out the counter
- **Set Monthly Request Limit** — change your plan limit
- **Refresh Bars** — force a re-render

## How the counter works

- The **month bar** updates automatically every 60 seconds.
- The **Copilot usage counter** is stored in VS Code's global state (persists across sessions) and **auto-resets to 0** when a new calendar month begins.
- Update your current usage manually from GitHub's settings page, or increment it as you go.

## Development

```bash
npm install
npm run compile   # or `npm run watch`
# Press F5 to launch the Extension Host
```

## License

MIT
