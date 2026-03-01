# Clawster Project Instructions

## Git Workflow

Before any push:
1. Always rebase from main first: `git fetch origin && git rebase origin/main`
2. Resolve any conflicts that arise
3. If uncertain how to resolve a conflict, ask the user for guidance with explanation of the conflict

## Branching Workflow

When starting work on a branch (folder name matches the intended branch name):

1. Check for uncommitted changes with `git status`
2. If there are uncommitted changes, commit them first
3. Switch to main branch: `git checkout main`
4. Pull latest updates: `git pull`
5. Create and switch to the new branch matching the folder name: `git checkout -b <folder-name>`

This workflow assumes the user either:
- Created a new folder for that branch (cloned the repo, renamed folder to branch name)
- Renamed an existing folder from an abandoned branch to the new branch name

**Important:** Folder renaming must be done by the user before starting the Claude session. Claude cannot rename the folder it's currently working inside of.

At the end of the branch creation flow, always provide the rename command for reusing the folder later:
```
mv /path/to/current-folder /path/to/new-branch-name
```

## Linear Issue Workflow

When creating Linear issues for Clawster:

1. Ask for priority (Urgent/High/Normal/Low)
2. Add the appropriate label:
   - **Bug** - Bug fixes
   - **Feature** - New features
   - **Improvement** - Enhancements to existing features
   - **idea** - Future ideas to explore
3. Add the issue to the **Clawster Roadmap** project
4. Update the Clawster Roadmap description to include the new issue in the appropriate priority section:
   - Urgent Priority
   - High Priority
   - Medium Priority (for Normal)
   - Low Priority

## macOS Build & Notarization

### Prerequisites
The `electron-builder.env` file in the project root must contain:
```
APPLE_ID=<apple-id-email>
APPLE_APP_SPECIFIC_PASSWORD=<app-specific-password>
APPLE_TEAM_ID=39428U49B4
```

### Build Commands
- **Build for macOS:** `npm run dist:mac`
- **Build and deploy to landing page:** `npm run dist:mac:deploy`

### Updating Version for Release
1. Update version in `package.json`: `"version": "0.1.x"`
2. Run `npm run dist:mac` to build and notarize
3. Release files are output to `/release/` folder

### Checking Notarization Status
```bash
# Check if DMG is notarized
xcrun stapler validate /path/to/Clawster-x.x.x-arm64.dmg

# Check if app is notarized
spctl -a -vvv -t install /path/to/Clawster.app
```

### Manual Notarization (if build skipped it)
```bash
# Submit for notarization
xcrun notarytool submit /path/to/Clawster.dmg \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "39428U49B4" \
  --wait

# Staple the ticket after approval
xcrun stapler staple /path/to/Clawster.dmg
```

### Troubleshooting
- If build shows `skipped macOS notarization reason=notarize options were unable to be generated`, check that `electron-builder.env` exists and contains valid credentials
- Notarization requires an app-specific password from appleid.apple.com (not your regular Apple ID password)
