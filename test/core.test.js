const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildNumberedSessionName,
  buildSessionName,
  getSessionGroupName,
  listSshHosts,
  parseScreenSessions,
  parseTmuxSessions,
  sanitizeSessionName
} = require('../out/core');

test('session names are sanitized and bounded', () => {
  assert.equal(sanitizeSessionName('hello world!'), 'hello-world-');
  assert.equal(buildNumberedSessionName('terminal', 12), 'terminal-12');
  assert.equal(buildSessionName('terminal', 'a'.repeat(40)).length, 24);
});

test('sessions are assigned to fixed groups', () => {
  assert.equal(getSessionGroupName('terminal-1'), 'terminal');
  assert.equal(getSessionGroupName('Terminal-work'), 'terminal');
  assert.equal(getSessionGroupName('legacy-tool-1'), 'other');
});

test('backend output parsers return session names', () => {
  assert.deepEqual(parseTmuxSessions('terminal-1\nother\n'), ['terminal-1', 'other']);
  assert.deepEqual(
    parseScreenSessions('123.terminal-1\t(Detached)\n456.other\t(Attached)\n'),
    ['terminal-1', 'other']
  );
  assert.deepEqual(parseScreenSessions('No Sockets found.'), []);
});

test('SSH hosts include nested files and exclude patterns', t => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-kernel-test-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const sshDir = path.join(homeDir, '.ssh');
  const includeDir = path.join(sshDir, 'config.d');
  fs.mkdirSync(includeDir, { recursive: true });
  fs.writeFileSync(path.join(sshDir, 'config'), [
    'Host Alpha alpha',
    'Host *',
    'Include config.d/*',
    'Include ${EXTRA_SSH_CONFIG}'
  ].join('\n'));
  fs.writeFileSync(path.join(includeDir, '10-work'), [
    'Host Beta',
    'Host !blocked Gamma',
    'Include ../config'
  ].join('\n'));
  fs.writeFileSync(path.join(sshDir, 'extra'), 'Host Delta # comment\n');

  assert.deepEqual(
    listSshHosts(homeDir, { EXTRA_SSH_CONFIG: path.join(sshDir, 'extra') }),
    ['Alpha', 'Beta', 'Delta', 'Gamma']
  );
});
