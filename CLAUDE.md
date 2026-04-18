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

## Releasing

### How to Release a New Version
1. Update version in `package.json`: `"version": "0.1.x"`
2. Commit and push the version bump
3. Tag and push:
   ```bash
   git tag v0.1.x
   git push origin v0.1.x
   ```
4. CI automatically builds (arm64 + x64), notarizes, and creates a **draft** GitHub Release
5. Go to [GitHub Releases](https://github.com/wuyuwenj/clawster/releases), review the draft, then click **Publish**
6. Users with the app installed receive an auto-update prompt on next launch

### Local Build (optional)
To build locally instead of using CI:
1. Create `electron-builder.env` in project root (see secrets in GitHub repo settings for values)
2. `npm run dist:mac` — builds and notarizes locally
3. Release files are output to `/release/`

### Auto-Update
The app uses `electron-updater` with GitHub Releases. On launch, it checks for new versions, downloads in the background, and prompts the user to restart.

### Troubleshooting
- If local build skips notarization, check that `electron-builder.env` exists with valid credentials
- Notarization requires an app-specific password from appleid.apple.com (not your regular Apple ID password)
- `electron-builder.env` is gitignored — each dev needs their own copy for local builds
