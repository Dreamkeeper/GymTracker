# Project-Specific Notes for Agents

## Settings Page URL Management

When updating features that modify the settings page (e.g., adding the routine persistence feature), remember:

### Testing Workflow

1. **URL Configuration:** The settings page URL is defined in `gymtracker/src/pkjs/index.js`:
   ```javascript
   var myConfigUrl = isDevMode ? 'https://silentjay.github.io/solid-lamp/index_dev.html' : 'https://silentjay.github.io/solid-lamp/';
   ```

2. **For local testing:** The URL should point to **your fork's GitHub Pages** (`silentjay.github.io/solid-lamp/`) so you can test your changes. Also ensure GitHub Pages is serving from your feature branch (Settings → Pages → select branch).

3. **Before PR:** Revert URL back to the **upstream maintainer's URL** before committing:
   ```javascript
   var myConfigUrl = isDevMode ? 'https://oliverano95.github.io/GymTracker/index_dev.html' : 'https://oliverano95.github.io/GymTracker/';
   ```

### Important Reminder
- **Use YOUR fork URL** when developing/testing features
- **Use UPSTREAM URL** when finalizing for a PR (to avoid exposing dev URLs in merged code)

### GitHub Pages Branch Configuration

When testing features on GitHub Pages that are on a non-main branch:
- Go to **Settings** → **Pages** → Select branch from dropdown
- This allows GitHub Pages to serve code from feature branches
- Remember to switch back after testing