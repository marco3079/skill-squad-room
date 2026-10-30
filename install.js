#!/usr/bin/env node
'use strict';
// Instalador (Windows, macOS, Linux). Sem dependências.
//
//   node install.js               instala tudo (skills + extensões deste repositório)
//   node install.js --dry-run     só mostra o que faria, sem alterar nada
//   node install.js --skill       só as skills (pasta skills/)
//   node install.js --extensions  só as extensões do VS Code (arquivos de dist/)
//   node install.js --build       reempacota os .vsix a partir de extensions/ antes de instalar (precisa de npm/npx)
//   node install.js --editor cursor   usa outro editor compatível com VS Code (padrão: code)
//   node install.js --hooks           SÓ o hook de registro automático: mescla uma entrada PostToolUse em
//                                     ~/.claude/settings.json (idempotente, com backup settings.json.bak-<data>)
//   node install.js --remove-hooks    remove essa entrada do settings.json (com backup)
//
// O que faz: copia cada pasta de skills/ para ~/.claude/skills/ e instala os .vsix de dist/ pela CLI do editor.
// O que NÃO faz por padrão: não altera settings.json, hooks, permissões nem nenhum outro arquivo seu.
// Só com --hooks / --remove-hooks (explícitos) o settings.json é tocado; JSON inválido aborta sem alterar nada.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const dry = has('--dry-run');
const onlySkill = has('--skill');
const onlyExt = has('--extensions');
const here = __dirname;
const skillsDir = path.join(here, 'skills');
const extDir = path.join(here, 'extensions');
const hooksMode = has('--hooks') || has('--remove-hooks');
// --hooks / --remove-hooks sozinhos só mexem no settings.json (a menos que --skill/--extensions também sejam passados)
const doSkill = (onlySkill || (!onlyExt && !hooksMode)) && fs.existsSync(skillsDir);
const doExt = (onlyExt || (!onlySkill && !hooksMode)) && fs.existsSync(extDir);
const editor = opt('--editor', 'code');
const log = (m) => console.log(m);
const step = (m) => log(`${dry ? '[simulação] ' : ''}${m}`);
const subdirs = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function run(cmd, cmdArgs, cwd) {
  // shell:true no Windows para achar code.cmd / npx.cmd
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function installSkills() {
  let ok = true;
  for (const name of subdirs(skillsDir)) {
    const src = path.join(skillsDir, name);
    const dst = path.join(os.homedir(), '.claude', 'skills', name);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) { log(`ERRO: skills/${name}/SKILL.md não encontrado.`); ok = false; continue; }
    const existed = fs.existsSync(dst);
    step(`${existed ? 'Atualizando' : 'Instalando'} skill ${name} em ${dst}`);
    if (!dry) {
      if (existed) fs.rmSync(dst, { recursive: true, force: true });
      copyDir(src, dst);
    }
  }
  return ok;
}

function buildVsix() {
  const dist = path.join(here, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  for (const ext of subdirs(extDir)) {
    const dir = path.join(extDir, ext);
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const out = path.join(dist, `${ext}-${pkg.version}.vsix`);
    step(`Empacotando ${ext} ${pkg.version} -> dist/`);
    if (dry) continue;
    for (const old of fs.readdirSync(dist)) if (old.startsWith(ext + '-') && old.endsWith('.vsix')) fs.rmSync(path.join(dist, old));
    const r = run('npx', ['--yes', '@vscode/vsce', 'package', '--allow-missing-repository', '--skip-license', '-o', out], dir);
    if (!r.ok) { log(`ERRO ao empacotar ${ext}:\n${r.out}`); return false; }
  }
  return true;
}

function installExtensions() {
  if (has('--build') && !buildVsix()) return false;
  const dist = path.join(here, 'dist');
  const vsix = fs.existsSync(dist) ? fs.readdirSync(dist).filter((f) => f.endsWith('.vsix')).sort() : [];
  if (!vsix.length) { log('ERRO: nenhum .vsix em dist/. Rode: node install.js --build'); return false; }
  const probe = run(editor, ['--version']);
  if (!probe.ok) {
    log(`ERRO: o comando "${editor}" não foi encontrado no PATH.`);
    log('Windows: reinstale o VS Code marcando "Adicionar ao PATH". macOS: Ctrl+Shift+P → "Shell Command: Install \'code\' command in PATH".');
    log('Alternativa manual: Extensões → ⋯ → "Instalar do VSIX…" e escolha os arquivos de dist/.');
    return false;
  }
  let ok = true;
  for (const f of vsix) {
    step(`Instalando extensão ${f} (${editor})`);
    if (dry) continue;
    const r = run(editor, ['--install-extension', path.join(dist, f), '--force']);
    const good = r.ok && /successfully installed/i.test(r.out);
    log(good ? `  ok: ${f}` : `  ERRO em ${f}:\n${r.out}`);
    ok = ok && good;
  }
  return ok;
}

const HOOK_MARK = 'squad-stream/scripts/hook-post-tool.js';

function entryHasMark(entry) {
  return !!entry && Array.isArray(entry.hooks) && entry.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(HOOK_MARK));
}

function manageHooks(remove) {
  const claudeDir = path.join(os.homedir(), '.claude');
  const file = path.join(claudeDir, 'settings.json');
  let cfg = {};
  let existed = false;
  if (fs.existsSync(file)) {
    existed = true;
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.trim()) {
      try { cfg = JSON.parse(raw); } catch (e) { log(`ERRO: ${file} não é um JSON válido (${e.message}). Nada foi alterado.`); return false; }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { log(`ERRO: ${file} não contém um objeto JSON. Nada foi alterado.`); return false; }
    }
  }
  if (cfg.hooks !== undefined && (typeof cfg.hooks !== 'object' || cfg.hooks === null || Array.isArray(cfg.hooks))) { log('ERRO: "hooks" no settings.json tem formato inesperado. Nada foi alterado.'); return false; }
  const cur = cfg.hooks && cfg.hooks.PostToolUse;
  if (cur !== undefined && !Array.isArray(cur)) { log('ERRO: "hooks.PostToolUse" no settings.json tem formato inesperado. Nada foi alterado.'); return false; }
  const list = cur || [];
  const present = list.some(entryHasMark);

  if (remove) {
    if (!present) { log('Hook de registro automático não está no settings.json; nada a remover.'); return true; }
    const kept = [];
    for (const entry of list) {
      if (!entryHasMark(entry)) { kept.push(entry); continue; }
      const rest = entry.hooks.filter((h) => !(h && typeof h.command === 'string' && h.command.includes(HOOK_MARK)));
      if (rest.length) kept.push({ ...entry, hooks: rest });
    }
    if (kept.length) cfg.hooks.PostToolUse = kept;
    else { delete cfg.hooks.PostToolUse; if (!Object.keys(cfg.hooks).length) delete cfg.hooks; }
    step(`Removendo o hook PostToolUse de ${file}`);
  } else {
    if (present) { log('Hook de registro automático já está no settings.json; nada a fazer.'); return true; }
    const script = path.join(os.homedir(), '.claude', 'skills', 'squad-stream', 'scripts', 'hook-post-tool.js').split(path.sep).join('/');
    cfg.hooks = cfg.hooks || {};
    cfg.hooks.PostToolUse = [...list, { matcher: '*', hooks: [{ type: 'command', command: `node "${script}"` }] }];
    step(`Adicionando o hook PostToolUse (matcher "*") em ${file}`);
    if (!fs.existsSync(path.join(os.homedir(), '.claude', 'skills', 'squad-stream'))) log('  aviso: a skill ainda não está em ~/.claude/skills/squad-stream (rode: node install.js --skill).');
  }
  if (dry) return true;
  fs.mkdirSync(claudeDir, { recursive: true });
  if (existed) {
    const bak = `${file}.bak-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)}`;
    fs.copyFileSync(file, bak);
    log(`  backup: ${bak}`);
  }
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return true;
}

log(`${path.basename(here)} — instalador`);
let ok = true;
if (doSkill) ok = installSkills() && ok;
if (doExt) ok = installExtensions() && ok;
if (hooksMode) {
  if (has('--hooks') && has('--remove-hooks')) { log('ERRO: use --hooks OU --remove-hooks, não os dois.'); process.exit(1); }
  ok = manageHooks(has('--remove-hooks')) && ok;
}
if (!doSkill && !doExt && !hooksMode) { log('Nada para instalar neste repositório com essas opções.'); process.exit(1); }

if (dry) log('\nSimulação concluída. Nada foi alterado.');
else if (ok) {
  log('\nConcluído.');
  if (doExt) log('→ Recarregue o VS Code: Ctrl+Shift+P → "Developer: Reload Window".');
  if (doSkill) log('→ Abra uma NOVA sessão do Claude Code para a skill aparecer.');
  if (hooksMode) log('→ Abra uma NOVA sessão do Claude Code para o hook valer. Ele só grava quando há sala ativa.');
} else {
  log('\nTerminou com erros (veja acima).');
  process.exit(1);
}
