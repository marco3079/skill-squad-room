'use strict';
// Testes sem frameworks: node test/tui.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.join(__dirname, '..');
const bus = path.join(repo, 'skills', 'squad-stream', 'scripts', 'bus.js');
const tui = path.join(repo, 'skills', 'squad-stream', 'scripts', 'tui.js');
const installJs = path.join(repo, 'install.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-test-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envFor(home, squad) {
  const e = { ...process.env, HOME: home, USERPROFILE: home, SQUAD_DIR: squad, NO_COLOR: '1' };
  delete e.SQUAD_ROOM; delete e.SQUAD_USER;
  return e;
}
const busRun = (env, ...a) => spawnSync(process.execPath, [bus, ...a], { env, encoding: 'utf8' });

async function waitFor(fn, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await sleep(50); }
  throw new Error('timeout esperando condição');
}

async function testTui() {
  const home = path.join(tmp, 'home1'); fs.mkdirSync(home);
  const squad = path.join(tmp, 'squad1');
  const env = envFor(home, squad);
  busRun(env, 'init', 'sala1', '--active');
  busRun(env, 'post', 'sala1', '--from', 'api', '--type', 'status', '--text', 'evento-antigo');

  const p = spawn(process.execPath, [tui], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  let code = null;
  p.on('exit', (c) => { code = c; });

  await waitFor(() => out.includes('evento-antigo') && out.includes('ao vivo'));
  assert(!out.includes('\x1b['), 'sem cores quando não é TTY');
  busRun(env, 'post', 'sala1', '--from', 'ui', '--type', 'note', '--text', 'evento-novo @user');
  await waitFor(() => out.includes('evento-novo'));

  p.stdin.write('@api oi\n');
  const logFile = path.join(squad, 'sala1', 'log.jsonl');
  await waitFor(() => fs.readFileSync(logFile, 'utf8').includes('"@api oi"'));
  const evs = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const mine = evs.find((e) => e.text === '@api oi');
  assert.strictEqual(mine.from, 'user');
  assert.strictEqual(mine.to, 'all');
  assert.deepStrictEqual(mine.mentions, ['api']);

  p.stdin.write('/q\n');
  await waitFor(() => code !== null);
  assert.strictEqual(code, 0);

  // EOF também sai limpo
  const p2 = spawn(process.execPath, [tui, 'sala1'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let code2 = null;
  p2.on('exit', (c) => { code2 = c; });
  p2.stdin.end();
  await waitFor(() => code2 !== null);
  assert.strictEqual(code2, 0);
  console.log('ok: tui');
}

function installRun(home, ...a) {
  const env = envFor(home, path.join(tmp, 'sq'));
  return spawnSync(process.execPath, [installJs, ...a], { env, encoding: 'utf8' });
}
const settingsOf = (home) => path.join(home, '.claude', 'settings.json');
const baks = (home) => fs.readdirSync(path.join(home, '.claude')).filter((f) => f.startsWith('settings.json.bak-'));

function testInstallHooks() {
  const home = path.join(tmp, 'home2');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const original = { model: 'opus', permissions: { allow: ['Bash(ls)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo x' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo s' }] }] } };
  fs.writeFileSync(settingsOf(home), JSON.stringify(original, null, 2));

  let r = installRun(home, '--hooks', '--dry-run');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsOf(home), 'utf8')), original, 'dry-run não altera');
  assert.strictEqual(baks(home).length, 0);
  assert(!fs.existsSync(path.join(home, '.claude', 'skills')), '--hooks não instala skill');

  r = installRun(home, '--hooks');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  let cfg = JSON.parse(fs.readFileSync(settingsOf(home), 'utf8'));
  assert.strictEqual(cfg.model, 'opus');
  assert.deepStrictEqual(cfg.permissions, original.permissions);
  assert.deepStrictEqual(cfg.hooks.Stop, original.hooks.Stop);
  assert.strictEqual(cfg.hooks.PostToolUse.length, 2);
  assert.deepStrictEqual(cfg.hooks.PostToolUse[0], original.hooks.PostToolUse[0]);
  const added = cfg.hooks.PostToolUse[1];
  assert.strictEqual(added.matcher, '*');
  assert(added.hooks[0].command.includes('squad-stream/scripts/hook-post-tool.js'));
  assert(/^node "/.test(added.hooks[0].command) && added.hooks[0].command.endsWith('"'));
  assert.strictEqual(baks(home).length, 1);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(home, '.claude', baks(home)[0]), 'utf8')), original);

  const before = fs.readFileSync(settingsOf(home), 'utf8');
  r = installRun(home, '--hooks');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.readFileSync(settingsOf(home), 'utf8'), before, 'idempotente');
  assert.strictEqual(baks(home).length, 1, 'sem novo backup quando nada muda');

  r = installRun(home, '--remove-hooks', '--dry-run');
  assert.strictEqual(fs.readFileSync(settingsOf(home), 'utf8'), before);
  r = installRun(home, '--remove-hooks');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  cfg = JSON.parse(fs.readFileSync(settingsOf(home), 'utf8'));
  assert.deepStrictEqual(cfg, original, 'remoção restaura o conteúdo original');
  assert(baks(home).length >= 1);

  // sem settings.json: cria
  const home3 = path.join(tmp, 'home3'); fs.mkdirSync(home3);
  r = installRun(home3, '--hooks');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(settingsOf(home3), 'utf8')).hooks.PostToolUse.length, 1);

  // JSON inválido aborta sem alterar
  const home4 = path.join(tmp, 'home4');
  fs.mkdirSync(path.join(home4, '.claude'), { recursive: true });
  fs.writeFileSync(settingsOf(home4), '{ "a": 1,, }');
  for (const flag of ['--hooks', '--remove-hooks']) {
    r = installRun(home4, flag);
    assert.notStrictEqual(r.status, 0, 'deve falhar com JSON inválido');
    assert.strictEqual(fs.readFileSync(settingsOf(home4), 'utf8'), '{ "a": 1,, }');
    assert.strictEqual(baks(home4).length, 0);
  }
  console.log('ok: install --hooks');
}

function testPlugin() {
  const j = (f) => JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8'));
  assert.strictEqual(j('.claude-plugin/plugin.json').name, 'squad-stream');
  assert.strictEqual(j('.claude-plugin/marketplace.json').plugins[0].source, './');
  assert.strictEqual(j('hooks/hooks.json').hooks.PostToolUse[0].matcher, '*');
  console.log('ok: arquivos do plugin');
}

(async () => {
  try {
    await testTui();
    testInstallHooks();
    testPlugin();
    console.log('todos os testes passaram');
  } catch (e) {
    console.error('FALHOU:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
