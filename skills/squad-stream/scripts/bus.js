#!/usr/bin/env node
'use strict';
// Canal de comunicação (JSONL) entre agentes: eventos em tempo real, mensagens diretas, claims de arquivo.
// Uso: node bus.js <comando> <sala> [opções]   (veja `node bus.js help`)

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.SQUAD_DIR || path.join(os.homedir(), '.claude-squad');

function die(msg, code = 1) {
  console.error('squad: ' + msg);
  process.exit(code);
}

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
    } else o._.push(a);
  }
  return o;
}

function roomDir(room) {
  if (!room || !/^[\w.-]{1,64}$/.test(room)) die('nome de sala inválido (use letras, números, . _ -)');
  return path.join(ROOT, room);
}
const logFile = (room) => path.join(roomDir(room), 'log.jsonl');

function ensureRoom(room) {
  const d = roomDir(room);
  fs.mkdirSync(path.join(d, 'cursors'), { recursive: true });
  fs.mkdirSync(path.join(d, 'locks'), { recursive: true });
  if (!fs.existsSync(logFile(room))) fs.writeFileSync(logFile(room), '');
}

function post(room, ev) {
  ensureRoom(room);
  // Conversa é SEMPRE pública no grupo: "--to X" vira uma menção "@X" dentro da mensagem.
  let text = String(ev.text == null ? '' : ev.text);
  const target = ev.to && ev.to !== 'all' ? String(ev.to) : null;
  if (target && !text.includes('@' + target)) text = '@' + target + ' ' + text;
  const mentions = [...new Set((text.match(/@([\w.-]+)/g) || []).map((s) => s.slice(1)))];
  const e = {
    ts: new Date().toISOString(),
    from: ev.from || 'main',
    to: 'all',
    type: ev.type || 'msg',
    file: ev.file || undefined,
    text: text.slice(0, 4000),
    mentions: mentions.length ? mentions : undefined,
  };
  fs.appendFileSync(logFile(room), JSON.stringify(e) + '\n');
  return e;
}

function readAll(room) {
  try {
    return fs.readFileSync(logFile(room), 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (e) { return { ts: '', from: '?', to: 'all', type: 'raw', text: l }; }
    });
  } catch (e) { return []; }
}

function fmt(e) {
  const d = new Date(e.ts);
  const t = isNaN(d) ? '' : d.toTimeString().slice(0, 8);
  const arrow = e.to && e.to !== 'all' ? `${e.from}→${e.to}` : e.from;
  const f = e.file ? ` ${e.file}` : '';
  const txt = String(e.text || '').replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 400);
  return `[${t}] ${arrow} (${e.type})${f}${txt ? ': ' + txt : ''}`;
}

const fmtFor = (e, agent) => ((e.mentions || []).includes(agent) ? '★ ' : '') + fmt(e);

const cursorFile = (room, agent) => path.join(roomDir(room), 'cursors', agent.replace(/[^\w.-]/g, '_'));
function getCursor(room, agent) {
  try { return parseInt(fs.readFileSync(cursorFile(room, agent), 'utf8'), 10) || 0; } catch (e) { return 0; }
}

// eventos informativos que só aparecem no tail, nunca na caixa de entrada de um agente
const NOISE = new Set(['system', 'join', 'leave', 'edit', 'claim', 'release', 'action']);

function inbox(room, agent, peek) {
  const all = readAll(room);
  const cur = getCursor(room, agent);
  const mine = all.slice(cur).filter((e) => e.from !== agent && (e.to === 'all' || e.to === agent) && !NOISE.has(e.type));
  if (!peek) fs.writeFileSync(cursorFile(room, agent), String(all.length));
  return mine;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- claims de arquivo (lock por mkdir atômico) ----------
function lockPath(room, file) {
  const h = crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(roomDir(room), 'locks', h);
}
function claim(room, agent, file, ttl) {
  ensureRoom(room);
  const lp = lockPath(room, file);
  for (let tries = 0; tries < 2; tries++) {
    try {
      fs.mkdirSync(lp);
      fs.writeFileSync(path.join(lp, 'owner.json'), JSON.stringify({ agent, file: path.resolve(file), ts: Date.now(), ttl }));
      return { ok: true };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(path.join(lp, 'owner.json'), 'utf8')); } catch (e2) { /* ignore */ }
      if (owner && owner.agent === agent) { owner.ts = Date.now(); fs.writeFileSync(path.join(lp, 'owner.json'), JSON.stringify(owner)); return { ok: true }; }
      const expired = !owner || Date.now() - owner.ts > (owner.ttl || 600) * 1000;
      if (!expired) return { ok: false, owner: owner.agent };
      fs.rmSync(lp, { recursive: true, force: true });
    }
  }
  return { ok: false, owner: '?' };
}
function release(room, agent, file) {
  const locks = path.join(roomDir(room), 'locks');
  const targets = file ? [lockPath(room, file)] : fs.existsSync(locks) ? fs.readdirSync(locks).map((n) => path.join(locks, n)) : [];
  let n = 0;
  for (const lp of targets) {
    try {
      const owner = JSON.parse(fs.readFileSync(path.join(lp, 'owner.json'), 'utf8'));
      if (owner.agent === agent) { fs.rmSync(lp, { recursive: true, force: true }); n++; }
    } catch (e) { /* ignore */ }
  }
  return n;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const [cmd, room] = o._;
  const agent = o.agent || o.from || 'main';

  switch (cmd) {
    case 'init': {
      ensureRoom(room);
      if (o.active) fs.writeFileSync(path.join(ROOT, 'ACTIVE'), room);
      post(room, { from: 'main', type: 'system', text: 'sala criada' });
      console.log(`sala "${room}" pronta em ${roomDir(room)}`);
      break;
    }
    case 'join': {
      post(room, { from: agent, type: 'join', text: o.role || '' });
      console.log(`${agent} entrou em "${room}"`);
      break;
    }
    case 'post': {
      let text = o.text;
      if (text === undefined || text === true) {
        try { text = fs.readFileSync(0, 'utf8').trim(); } catch (e) { text = ''; }
      }
      post(room, { from: o.from || agent, to: o.to, type: o.type, file: o.file, text });
      break;
    }
    case 'tail': {
      ensureRoom(room);
      const types = o.types ? String(o.types).split(',') : null;
      const show = (e) => {
        if (types && !types.includes(e.type)) return false;
        if (o.agent && !(e.to === 'all' || e.to === o.agent || e.from === o.agent)) return false;
        return true;
      };
      let offset = o['from-start'] ? 0 : fs.statSync(logFile(room)).size;
      let buf = '';
      const pump = () => {
        const size = fs.statSync(logFile(room)).size;
        if (size <= offset) return;
        const fd = fs.openSync(logFile(room), 'r');
        const b = Buffer.alloc(size - offset);
        fs.readSync(fd, b, 0, b.length, offset);
        fs.closeSync(fd);
        offset = size;
        buf += b.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) {
          if (!l) continue;
          let e;
          try { e = JSON.parse(l); } catch (err) { continue; }
          if (show(e)) console.log(fmt(e));
          if (e.type === 'done' && e.from === 'main' && o['stop-on-done']) process.exit(0);
        }
      };
      pump();
      if (!o.follow) break;
      for (;;) { await sleep(400); pump(); }
    }
    case 'inbox': {
      const msgs = inbox(room, agent, !!o.peek);
      if (!msgs.length) console.log('(sem mensagens novas)');
      for (const e of msgs) console.log(fmtFor(e, agent));
      break;
    }
    case 'wait': {
      const deadline = Date.now() + (parseFloat(o.timeout) || 60) * 1000;
      for (;;) {
        const msgs = inbox(room, agent, false);
        if (msgs.length) { for (const e of msgs) console.log(fmtFor(e, agent)); return; }
        if (Date.now() > deadline) { console.log('(timeout sem mensagens)'); process.exit(3); }
        await sleep(500);
      }
    }
    case 'claim': {
      if (!o.file) die('--file obrigatório');
      const r = claim(room, agent, o.file, parseInt(o.ttl, 10) || 600);
      if (!r.ok) { console.log(`OCUPADO: ${o.file} está com ${r.owner}. Peça via post --to ${r.owner} ou edite outro arquivo.`); process.exit(2); }
      post(room, { from: agent, type: 'claim', file: o.file, text: 'reservou' });
      console.log('ok: arquivo reservado');
      break;
    }
    case 'release': {
      const n = release(room, agent, o.all ? null : o.file);
      post(room, { from: agent, type: 'release', file: o.file, text: o.all ? 'liberou tudo' : 'liberou' });
      console.log(`liberado(s): ${n}`);
      break;
    }
    case 'who': {
      const m = new Map();
      for (const e of readAll(room)) {
        if (e.type === 'join') m.set(e.from, e.text || '');
        if (e.type === 'leave' || e.type === 'done') if (e.from !== 'main') m.delete(e.from);
      }
      if (!m.size) console.log('(ninguém na sala)');
      for (const [a, r] of m) console.log(`${a}${r ? ' — ' + r : ''}`);
      break;
    }
    case 'status': {
      const s = {};
      for (const e of readAll(room)) { s[e.from] = s[e.from] || {}; s[e.from][e.type] = (s[e.from][e.type] || 0) + 1; }
      console.log(JSON.stringify(s, null, 2));
      break;
    }
    case 'rooms': {
      if (fs.existsSync(ROOT)) for (const n of fs.readdirSync(ROOT)) if (fs.existsSync(path.join(ROOT, n, 'log.jsonl'))) console.log(n);
      break;
    }
    case 'end': {
      post(room, { from: 'main', type: 'done', text: o.text || 'encerrado' });
      release(room, agent, null);
      console.log('sala encerrada (log mantido)');
      break;
    }
    default:
      console.log(`uso: node bus.js <comando> <sala> [opções]
  init <sala> [--active]                  cria a sala (--active: hooks passam a usá-la)
  join <sala> --agent N [--role "..."]    entra na sala
  post <sala> --from N [--to N (vira @N no grupo)] [--type status|note|action|edit|question|answer|msg|done] [--file F] --text "..."   (ou texto via stdin)
                                            Conversa é sempre pública: perguntas usam @nome no texto.
  tail <sala> [--follow] [--from-start] [--agent N] [--types a,b]   stream de eventos (use com Monitor)
  inbox <sala> --agent N [--peek]         mensagens novas do grupo (★ = menciona N; ações/edições só no tail)
  wait <sala> --agent N [--timeout 60]    bloqueia até chegar mensagem para N
  claim <sala> --agent N --file F         reserva arquivo (exit 2 se ocupado)
  release <sala> --agent N [--file F|--all]
  who|status|rooms|end <sala>
  SQUAD_DIR=<pasta> muda onde ficam as salas (padrão ~/.claude-squad)`);
  }
}

module.exports = { post, ROOT, ensureRoom };
if (require.main === module) main().catch((e) => die(e && e.message ? e.message : String(e)));
