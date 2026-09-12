import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type SessionGroup = 'terminal' | 'other';

export function sanitizeSessionName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function buildNumberedSessionName(
  prefix: string,
  suffix: number | string,
  maxLength = 24
): string {
  const safePrefix = sanitizeSessionName(prefix) || 'terminal';
  const suffixText = String(suffix);
  const maxPrefixLen = Math.max(1, maxLength - suffixText.length - 1);
  const trimmedPrefix = safePrefix.slice(0, maxPrefixLen);
  return `${trimmedPrefix}-${suffixText}`;
}

export function buildSessionName(prefix: string, suffix: string, maxLength = 24): string {
  const safePrefix = sanitizeSessionName(prefix) || 'terminal';
  const safeSuffix = sanitizeSessionName(suffix);
  if (safePrefix.length >= maxLength - 1) {
    const trimmedPrefix = safePrefix.slice(0, maxLength - 2);
    const trimmedSuffix = safeSuffix.slice(0, 1);
    return `${trimmedPrefix}-${trimmedSuffix}`;
  }
  const maxSuffixLen = Math.max(1, maxLength - safePrefix.length - 1);
  const trimmedSuffix = safeSuffix.slice(0, maxSuffixLen);
  return `${safePrefix}-${trimmedSuffix}`;
}

export function parseTmuxSessions(out: string): string[] {
  if (!out) return [];
  return out.split('\n').map(line => line.trim()).filter(Boolean);
}

export function parseScreenSessions(out: string): string[] {
  if (!out || /No Sockets found/i.test(out)) return [];
  return out
    .split('\n')
    .map(line => line.trim())
    .map(line => /^\d+\.(\S+)\s/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}

export function getSessionGroupName(session: string): SessionGroup {
  return session.toLowerCase().startsWith('terminal-') ? 'terminal' : 'other';
}

function stripSshComment(line: string): string {
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

function splitSshArguments(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  const push = () => {
    if (!current) return;
    args.push(current);
    current = '';
  };

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      push();
    } else {
      current += char;
    }
  }
  if (escaped) current += '\\';
  push();
  return args;
}

function parseSshDirective(line: string): { keyword: string; args: string[] } | undefined {
  const content = stripSshComment(line).trim();
  if (!content) return undefined;
  const match = /^([^\s=]+)(?:\s*=\s*|\s+)(.*)$/.exec(content);
  if (!match) return undefined;
  return { keyword: match[1].toLowerCase(), args: splitSshArguments(match[2]) };
}

function expandEnvironment(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, braced: string | undefined, plain: string | undefined) => {
      const key = braced ?? plain;
      return key ? env[key] ?? '' : '';
    });
}

function globSegmentRegex(segment: string): RegExp {
  let source = '^';
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

function expandGlob(pattern: string): string[] {
  if (!/[*?]/.test(pattern)) return fs.existsSync(pattern) ? [pattern] : [];
  const parsed = path.parse(pattern);
  const segments = pattern.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let candidates = [parsed.root || '.'];
  for (const segment of segments) {
    const matcher = globSegmentRegex(segment);
    const next: string[] = [];
    for (const candidate of candidates) {
      if (/[*?]/.test(segment)) {
        try {
          fs.readdirSync(candidate, { withFileTypes: true })
            .filter(entry => matcher.test(entry.name))
            .forEach(entry => next.push(path.join(candidate, entry.name)));
        } catch {
          // Ignore unreadable include directories.
        }
      } else {
        next.push(path.join(candidate, segment));
      }
    }
    candidates = next;
  }
  return candidates.filter(candidate => fs.existsSync(candidate)).sort();
}

export function listSshHosts(
  homeDir = os.homedir(),
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const sshDir = path.join(homeDir, '.ssh');
  const entryConfig = path.join(sshDir, 'config');
  const hosts: string[] = [];
  const seenHosts = new Set<string>();
  const visitedFiles = new Set<string>();

  const addHost = (host: string) => {
    if (!host || host.startsWith('!') || /[*?]/.test(host)) return;
    const key = host.toLowerCase();
    if (seenHosts.has(key)) return;
    seenHosts.add(key);
    hosts.push(host);
  };

  const readConfig = (configPath: string, depth: number) => {
    if (depth > 16) return;
    let resolvedPath: string;
    try {
      resolvedPath = fs.realpathSync(configPath);
    } catch {
      return;
    }
    if (visitedFiles.has(resolvedPath)) return;
    visitedFiles.add(resolvedPath);

    let config: string;
    try {
      config = fs.readFileSync(resolvedPath, 'utf8');
    } catch {
      return;
    }

    for (const line of config.split(/\r?\n/)) {
      const directive = parseSshDirective(line);
      if (!directive) continue;
      if (directive.keyword === 'host') {
        directive.args.forEach(addHost);
        continue;
      }
      if (directive.keyword !== 'include') continue;
      directive.args.forEach(includeValue => {
        let includePath = expandEnvironment(includeValue, env);
        includePath = includePath.replace(/^~(?=$|[\\/])/, homeDir);
        if (!path.isAbsolute(includePath)) includePath = path.join(sshDir, includePath);
        expandGlob(path.normalize(includePath)).forEach(file => readConfig(file, depth + 1));
      });
    }
  };

  readConfig(entryConfig, 0);
  return hosts.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
