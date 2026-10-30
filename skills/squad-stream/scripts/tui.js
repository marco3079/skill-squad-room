#!/usr/bin/env node
'use strict';
// Visualizador + chat da sala no terminal (para quem usa só o Claude Code, sem VS Code).
// Uso: node tui.js [sala]      (sem sala: a de <SQUAD_DIR>/ACTIVE ou a mais recente)
// Escreva para falar no grupo (mensagem pública). Comandos: /rooms /room <nome> /who /actions on|off /q

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { post, ROOT, ensureRoom } = require('./bus.js');

const USER = process.env.SQUAD_USER || 'user';
const HISTORY = 200;
const POLL_MS = 400;
const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const interactive = !!(process.stdin.isTTY && process.stdout.isTTY);

const esc = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = (s) => esc('90', s);
const bold = (s) => esc('1', s);
const PALETTE = [203, 209, 179, 149, 114, 79, 80, 75, 111, 141, 177, 213, 217, 222, 156, 123];
function agentColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (s) => esc('38;5;' + PALETTE[h % PALETTE.length], s);
}
const TYPE_STYLE = { question: '33', answer: '32', done: '35', note: '36', status: '34' };
const QUIET = new Set(['action', 'edit', 'claim', 'release']);

let room = null;
let offset = 0;
let buf = '';
let showActions = true;
let rl = null;
let timer = null;

const logPath = (r) => path.join(ROOT, r, 'log.jsonl');
const validRoom = (r) => /^[\w.-]{1,64}$/.test(r || '');

function listRooms() {
  try {
    return fs.readdirSync(ROOT)
      .filter((n) => fs.existsSync(logPath(n)))
      .map((n) => ({ n, t: fs.statSync(logPath(n)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .map((x) => x.n);
  } catch (e) { return []; }
}
function defaultRoom() {
  try {
    const a = fs.readFileSync(path.join(ROOT, 'ACTIVE'), 'utf8').trim();
    if (validRoom(a)) return a;
  } catch (e) { /* sem ACTIVE */ }
  return listRooms()[0] || null;
}

// imprime sem bagunçar a linha que o usuário está digitando
function out(text) {
  if (interactive && rl) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(text + '\n');
    rl.prompt(true);
  } else {
    process.stdout.write(text + '\n');
  }
}

function render(e) {
  const d = new Date(e.ts);
  const time = isNaN(d) ? '--:--:--' : d.toTimeString().slice(0, 8);
  const type = String(e.type || 'msg');
  const quiet = QUIET.has(type);
  const color = agentColor(e.from);
  const mine = (e.mentions || []).some((m) => m === USER || m === 'main');
  let text = String(e.text == null ? '' : e.text).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 600);
  if (quiet) text = dim(text);
  else text = text.replace(/@[\w.-]+/g, (m) => esc('1;4;36', m));
  const label = quiet ? dim(`[${type}]`) : esc(TYPE_STYLE[type] || '37', `[${type}]`);
  const file = e.file ? ' ' + (quiet ? dim(e.file) : e.file) : '';
  const mark = mine ? esc('1;33', '★ ') : '  ';
  const head = `${mark}${dim(time)} ${color(bold(e.from || '?'))} ${label}${file}${text ? ' ' + text : ''}`;
  return mine ? bold(head) : head;
}

function show(e) {
  if (!showActions && QUIET.has(e.type)) return;
  out(render(e));
}

function parseLine(l) {
  try { return JSON.parse(l); } catch (e) { return { ts: '', from: '?', type: 'raw', text: l }; }
}

function loadHistory() {
  let data = '';
  try { data = fs.readFileSync(logPath(room), 'utf8'); } catch (e) { /* vazia */ }
  offset = Buffer.byteLength(data);
  const nl = data.lastIndexOf('\n');
  buf = nl >= 0 ? data.slice(nl + 1) : data; // linha parcial fica para o próximo poll
  const complete = nl >= 0 ? data.slice(0, nl) : '';
  const evs = complete.split('\n').filter(Boolean).map(parseLine);
  const recent = evs.slice(-HISTORY);
  if (evs.length > recent.length) out(dim(`… ${evs.length - recent.length} eventos anteriores omitidos`));
  for (const e of recent) show(e);
  out(dim('— ao vivo —'));
}

function poll() {
  let size;
  try { size = fs.statSync(logPath(room)).size; } catch (e) { return; }
  if (size < offset) { offset = 0; buf = ''; out(dim('(log reiniciado)')); }
  if (size === offset) return;
  let chunk;
  try {
    const fd = fs.openSync(logPath(room), 'r');
    const b = Buffer.alloc(size - offset);
    fs.readSync(fd, b, 0, b.length, offset);
    fs.closeSync(fd);
    chunk = b;
  } catch (e) { return; }
  offset = size;
  buf += chunk.toString('utf8');
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const l of lines) if (l) show(parseLine(l));
}

function openRoom(r) {
  room = r;
  ensureRoom(room);
  out(bold(`Sala "${room}"`) + dim(`  (${path.join(ROOT, room)}) — você é "${USER}". /q sai, /rooms, /room <nome>, /who, /actions on|off`));
  loadHistory();
}

function who() {
  const m = new Map();
  try {
    const data = fs.readFileSync(logPath(room), 'utf8').split('\n').filter(Boolean).map(parseLine);
    for (const e of data) {
      if (e.type === 'join') m.set(e.from, e.text || '');
      if ((e.type === 'leave' || e.type === 'done') && e.from !== 'main') m.delete(e.from);
    }
  } catch (e) { /* ignore */ }
  if (!m.size) out(dim('(ninguém na sala)'));
  for (const [a, r] of m) out(agentColor(a)(a) + (r ? dim(' — ' + r) : ''));
}

function quit(code) {
  if (timer) clearInterval(timer);
  if (rl) { const r = rl; rl = null; try { r.close(); } catch (e) { /* ignore */ } }
  process.exit(code || 0);
}

function handle(line) {
  const t = line.trim();
  if (!t) return;
  if (t[0] === '/') {
    const [cmd, ...rest] = t.split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case '/q': case '/quit': case '/sair': return quit(0);
      case '/rooms': {
        const rs = listRooms();
        out(rs.length ? rs.map((r) => (r === room ? bold(r + ' *') : r)).join('\n') : dim('(nenhuma sala)'));
        return;
      }
      case '/room':
        if (!validRoom(arg)) return out('uso: /room <nome>  (letras, números, . _ -)');
        offset = 0; buf = '';
        return openRoom(arg);
      case '/who': return who();
      case '/actions':
        if (arg !== 'on' && arg !== 'off') return out('uso: /actions on|off  (agora: ' + (showActions ? 'on' : 'off') + ')');
        showActions = arg === 'on';
        return out(dim('ações/edições ' + (showActions ? 'visíveis' : 'ocultas')));
      default: return out(`comando desconhecido: ${cmd}`);
    }
  }
  try {
    post(room, { from: USER, type: 'msg', text: t });
    poll(); // mostra a própria mensagem já
  } catch (e) { out('erro ao enviar: ' + (e && e.message ? e.message : e)); }
}

function main() {
  const arg = process.argv[2];
  if (arg === '-h' || arg === '--help') {
    console.log('uso: node tui.js [sala]\n  SQUAD_DIR (pasta das salas), SQUAD_USER (seu nome, padrão "user"), NO_COLOR=1 (sem cores)');
    return;
  }
  const r = arg || defaultRoom();
  if (!r) { console.error('tui: nenhuma sala encontrada em ' + ROOT + '. Passe o nome: node tui.js <sala>'); process.exit(1); }
  if (!validRoom(r)) { console.error('tui: nome de sala inválido'); process.exit(1); }

  rl = readline.createInterface({
    input: process.stdin,
    output: interactive ? process.stdout : undefined,
    terminal: interactive,
    prompt: interactive ? `${USER}> ` : '',
  });
  openRoom(r);
  if (interactive) rl.prompt(true);
  timer = setInterval(poll, POLL_MS);
  rl.on('line', handle);
  rl.on('close', () => quit(0)); // EOF e Ctrl+D (Ctrl+C no readline também fecha)
  process.on('SIGINT', () => quit(0));
}

main();
