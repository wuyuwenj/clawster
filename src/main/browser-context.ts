import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface BrowserContext {
  browser: string;
  url: string;
  title: string;
  domain: string;
}

const BROWSERS = new Set([
  'Google Chrome', 'Safari', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Chromium',
  'Google Chrome Canary', 'Vivaldi', 'Opera',
]);

const CHROMIUM_BROWSERS = new Set([
  'Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Chromium',
  'Google Chrome Canary', 'Vivaldi', 'Opera',
]);

const BLOCKED_DOMAINS = new Set([
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
  'online.bankofamerica.com', 'chase.com', 'wellsfargo.com', 'citi.com',
  'portal.azure.com', 'console.aws.amazon.com',
  'healthcare.gov', 'mychart.com',
  'accounts.google.com', 'login.microsoftonline.com',
]);

export function isBrowser(appName: string): boolean {
  return BROWSERS.has(appName);
}

export function parseDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isBlockedDomain(domain: string): boolean {
  for (const blocked of BLOCKED_DOMAINS) {
    if (domain === blocked || domain.endsWith('.' + blocked)) return true;
  }
  return false;
}

async function getChromiumTabInfo(appName: string): Promise<{ url: string; title: string } | null> {
  const script = `
    tell application "${appName}"
      set tabURL to URL of active tab of front window
      set tabTitle to title of active tab of front window
      return tabURL & "|||" & tabTitle
    end tell`;
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 3000 });
    const [url, title] = stdout.trim().split('|||');
    if (url && title) return { url, title };
    return null;
  } catch {
    return null;
  }
}

async function getSafariTabInfo(): Promise<{ url: string; title: string } | null> {
  const script = `
    tell application "Safari"
      set tabURL to URL of current tab of front window
      set tabTitle to name of current tab of front window
      return tabURL & "|||" & tabTitle
    end tell`;
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 3000 });
    const [url, title] = stdout.trim().split('|||');
    if (url && title) return { url, title };
    return null;
  } catch {
    return null;
  }
}

export async function getBrowserContext(appName: string): Promise<BrowserContext | null> {
  if (!isBrowser(appName)) return null;

  let tabInfo: { url: string; title: string } | null = null;

  if (CHROMIUM_BROWSERS.has(appName)) {
    tabInfo = await getChromiumTabInfo(appName);
  } else if (appName === 'Safari') {
    tabInfo = await getSafariTabInfo();
  }

  if (!tabInfo) return null;

  const domain = parseDomain(tabInfo.url);
  if (isBlockedDomain(domain)) {
    console.log(`[BrowserContext] Blocked domain: ${domain}`);
    return null;
  }

  return {
    browser: appName,
    url: tabInfo.url,
    title: tabInfo.title,
    domain,
  };
}
