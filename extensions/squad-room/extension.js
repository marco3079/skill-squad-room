'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfg = () => vscode.workspace.getConfiguration('squadRoom');
const rootDir = () => {
  const c = String(cfg().get('dir', '') || '').trim();
  return c || process.env.SQUAD_DIR || path.join(os.homedir(), '.claude-squad');
};
const userName = () => String(cfg().get('userName', 'user') || 'user').trim() || 'user';
const logPath = (room) => path.join(rootDir(), room, 'log.jsonl');
const validRoom = (r) => typeof r === 'string' && /^[\w.-]{1,64}$/.test(r);

function listRooms() {
  try {
    return fs.readdirSync(rootDir()).filter((n) => validRoom(n) && fs.existsSync(logPath(n))).sort();
  } catch (e) { return []; }
}
function activeRoom() {
  try { return fs.readFileSync(path.join(rootDir(), 'ACTIVE'), 'utf8').trim(); } catch (e) { return ''; }
}
function parseLines(text) {
  const out = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch (e) { out.push({ ts: '', from: '?', to: 'all', type: 'raw', text: l }); }
  }
  return out;
}

class RoomView {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.room = context.globalState.get('squadRoom.current', '');
    this.offset = 0;
    this.partial = '';
    this.unseen = 0;
    this.lastRooms = '';
    this.timer = setInterval(() => this.tick(), 500);
  }

  dispose() { clearInterval(this.timer); }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    view.webview.html = html(view.webview.cspSource, nonce);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidChangeVisibility(() => { if (view.visible) { this.unseen = 0; this.setBadge(); } });
    view.onDidDispose(() => { this.view = undefined; });
  }

  post(msg) { try { if (this.view) this.view.webview.postMessage(msg); } catch (e) { /* ignore */ } }

  setBadge() {
    if (!this.view) return;
    this.view.badge = this.unseen > 0 ? { value: this.unseen, tooltip: `${this.unseen} novos eventos` } : undefined;
  }

  onMessage(m) {
    try {
      if (!m) return;
      switch (m.cmd) {
        case 'ready': this.lastRooms = ''; this.loadRoom(this.room); break;
        case 'select': this.loadRoom(String(m.room || '')); break;
        case 'send': this.send(m.to, m.text, m.type); break;
        case 'open': this.openFile(m.file); break;
        default: break;
      }
    } catch (e) { console.error('[squadRoom]', e); }
  }

  pickDefault() {
    const rooms = listRooms();
    if (this.room && rooms.includes(this.room)) return this.room;
    const a = activeRoom();
    if (a && rooms.includes(a)) return a;
    return rooms[0] || '';
  }

  loadRoom(room) {
    if (!room) room = this.pickDefault();
    this.room = validRoom(room) ? room : '';
    this.context.globalState.update('squadRoom.current', this.room);
    this.offset = 0;
    this.partial = '';
    this.unseen = 0;
    this.setBadge();
    let events = [];
    if (this.room && fs.existsSync(logPath(this.room))) {
      try {
        const text = fs.readFileSync(logPath(this.room), 'utf8');
        const lastNl = text.lastIndexOf('\n');
        const complete = lastNl >= 0 ? text.slice(0, lastNl + 1) : '';
        this.offset = Buffer.byteLength(complete, 'utf8');
        this.partial = '';
        events = parseLines(complete);
        const max = Math.max(50, Number(cfg().get('maxEvents', 1000)) || 1000);
        if (events.length > max) events = events.slice(-max);
      } catch (e) { /* ignore */ }
    }
    this.post({ type: 'rooms', rooms: listRooms(), current: this.room, user: userName() });
    this.post({ type: 'reset', events, room: this.room });
  }

  tick() {
    try {
      const rooms = listRooms();
      const key = rooms.join('|') + '#' + this.room;
      if (key !== this.lastRooms) {
        this.lastRooms = key;
        if (!this.room || !rooms.includes(this.room)) {
          const d = this.pickDefault();
          if (d !== this.room) { this.loadRoom(d); return; }
        }
        this.post({ type: 'rooms', rooms, current: this.room, user: userName() });
      }
      if (!this.room) return;
      const file = logPath(this.room);
      if (!fs.existsSync(file)) return;
      const size = fs.statSync(file).size;
      if (size < this.offset) { this.loadRoom(this.room); return; }
      if (size === this.offset) return;
      const fd = fs.openSync(file, 'r');
      const b = Buffer.alloc(size - this.offset);
      fs.readSync(fd, b, 0, b.length, this.offset);
      fs.closeSync(fd);
      this.offset = size;
      const text = this.partial + b.toString('utf8');
      const lastNl = text.lastIndexOf('\n');
      this.partial = lastNl >= 0 ? text.slice(lastNl + 1) : text;
      const events = lastNl >= 0 ? parseLines(text.slice(0, lastNl + 1)) : [];
      if (!events.length) return;
      this.post({ type: 'events', events });
      if (this.view && !this.view.visible) {
        this.unseen += events.filter((e) => e.type !== 'edit' && e.type !== 'claim' && e.type !== 'release').length;
        this.setBadge();
      }
    } catch (e) { /* ignore */ }
  }

  send(to, text, type) {
    text = String(text || '').trim();
    if (!text) return;
    if (!this.room) { vscode.window.showWarningMessage('Squad Room: selecione ou crie uma sala primeiro.'); return; }
    const t = String(to || 'all');
    const ev = {
      ts: new Date().toISOString(),
      from: userName(),
      to: /^[\w.-]{1,64}$/.test(t) ? t : 'all',
      type: type === 'question' ? 'question' : 'msg',
      text: text.slice(0, 4000),
    };
    try {
      fs.mkdirSync(path.dirname(logPath(this.room)), { recursive: true });
      fs.appendFileSync(logPath(this.room), JSON.stringify(ev) + '\n');
    } catch (e) {
      vscode.window.showErrorMessage('Squad Room: não consegui escrever na sala: ' + (e && e.message ? e.message : e));
    }
  }

  async openFile(file) {
    if (!file || typeof file !== 'string') return;
    const cands = [];
    if (path.isAbsolute(file)) cands.push(file);
    else for (const f of vscode.workspace.workspaceFolders || []) cands.push(path.join(f.uri.fsPath, file));
    for (const c of cands) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        await vscode.window.showTextDocument(vscode.Uri.file(c), { preview: true });
        return;
      }
    }
    vscode.window.showInformationMessage('Squad Room: arquivo não encontrado: ' + file);
  }

  async newRoom() {
    const name = await vscode.window.showInputBox({
      prompt: 'Nome da nova sala (letras, números, . _ -)',
      validateInput: (v) => (validRoom(v) ? undefined : 'Nome inválido'),
    });
    if (!name) return;
    try {
      fs.mkdirSync(path.join(rootDir(), name, 'cursors'), { recursive: true });
      fs.mkdirSync(path.join(rootDir(), name, 'locks'), { recursive: true });
      if (!fs.existsSync(logPath(name))) {
        fs.writeFileSync(logPath(name), JSON.stringify({ ts: new Date().toISOString(), from: userName(), to: 'all', type: 'system', text: 'sala criada' }) + '\n');
      }
      this.loadRoom(name);
    } catch (e) {
      vscode.window.showErrorMessage('Squad Room: ' + (e && e.message ? e.message : e));
    }
  }
}

function html(csp, nonce) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  html, body { height: 100%; }
  body { margin: 0; padding: 0; display: flex; flex-direction: column; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  .bar { display: flex; gap: 6px; align-items: center; padding: 6px 8px; flex-wrap: wrap; border-bottom: 1px solid var(--vscode-panel-border); }
  select, textarea, input { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; }
  select { padding: 2px 4px; max-width: 100%; }
  label.f { display: inline-flex; align-items: center; gap: 3px; color: var(--vscode-descriptionForeground); font-size: .92em; cursor: pointer; }
  .who { padding: 4px 8px; color: var(--vscode-descriptionForeground); font-size: .92em; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; flex-wrap: wrap; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
  #log { flex: 1; overflow-y: auto; padding: 4px 8px; }
  .ev { padding: 2px 0; line-height: 1.45; word-break: break-word; }
  .ev .t { color: var(--vscode-descriptionForeground); font-size: .85em; margin-right: 6px; font-variant-numeric: tabular-nums; }
  .ev .a { font-weight: 600; }
  .ev .to { color: var(--vscode-descriptionForeground); }
  .badge { font-size: .78em; padding: 0 5px; border-radius: 8px; margin-left: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .ev.edit .txt, .ev.claim .txt, .ev.release .txt, .ev.system, .ev.join, .ev.leave { color: var(--vscode-descriptionForeground); }
  .ev.question .badge { background: var(--vscode-editorWarning-foreground); color: #000; }
  .ev.done .badge { background: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); color: #000; }
  .ev.me { background: var(--vscode-list-hoverBackground); border-radius: 4px; padding: 2px 6px; }
  .ev.tome { border-left: 3px solid var(--vscode-editorWarning-foreground); padding-left: 6px; }
  a.file { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  a.file:hover { text-decoration: underline; }
  .empty { color: var(--vscode-descriptionForeground); padding: 10px 2px; line-height: 1.5; }
  .comp { border-top: 1px solid var(--vscode-panel-border); padding: 6px 8px; display: flex; flex-direction: column; gap: 6px; }
  .comp .row { display: flex; gap: 6px; align-items: center; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 42px; padding: 4px 6px; }
  button { font: inherit; border: 1px solid transparent; border-radius: 2px; padding: 3px 12px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style></head>
<body>
<div class="bar">
  <select id="room" title="Sala"></select>
  <label class="f"><input type="checkbox" id="fEdit" checked> edições</label>
  <label class="f"><input type="checkbox" id="fSys" checked> sistema</label>
  <label class="f"><input type="checkbox" id="fScroll" checked> rolar</label>
</div>
<div class="who" id="who"></div>
<div id="log"></div>
<div class="comp">
  <div class="row"><span>Para:</span><select id="to"><option value="all">todos</option></select>
    <label class="f"><input type="checkbox" id="isQ"> pergunta</label></div>
  <textarea id="txt" placeholder="Escreva para os agentes… (Enter envia, Shift+Enter quebra linha)"></textarea>
  <div class="row"><button id="send">Enviar</button><span id="hint" style="color:var(--vscode-descriptionForeground);font-size:.9em"></span></div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let events = [];
  let me = 'user';
  let room = '';
  const agents = new Map(); // nome -> {online, role}
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const color = (s) => 'hsl(' + hue(s) + ',65%,62%)';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const timeOf = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString(); };
  const NOISE = new Set(['system', 'join', 'leave']);
  const EDITS = new Set(['edit', 'claim', 'release']);

  function track(e) {
    if (!e || !e.from) return;
    if (e.from !== me) {
      const cur = agents.get(e.from) || { online: false, role: '' };
      if (e.type === 'join') { cur.online = true; cur.role = e.text || cur.role; }
      else if (e.type === 'done' || e.type === 'leave') cur.online = false;
      else cur.online = cur.online || true;
      agents.set(e.from, cur);
    }
  }
  function renderWho() {
    const names = [...agents.keys()];
    $('who').innerHTML = names.length ? names.map((n) => { const a = agents.get(n); return '<span title="' + esc(a.role) + '"><span class="dot" style="background:' + (a.online ? color(n) : 'transparent;border:1px solid ' + color(n)) + '"></span>' + esc(n) + '</span>'; }).join('') : '<span>ninguém na sala ainda</span>';
    const sel = $('to'); const cur = sel.value;
    sel.innerHTML = '<option value="all">todos</option>' + names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }
  function row(e) {
    const t = e.type || 'msg';
    if (EDITS.has(t) && !$('fEdit').checked) return '';
    if (NOISE.has(t) && !$('fSys').checked) return '';
    const mine = e.from === me;
    const toMe = e.to === me || e.to === 'user' || e.to === 'main';
    const to = e.to && e.to !== 'all' ? ' <span class="to">→ ' + esc(e.to) + '</span>' : '';
    const file = e.file ? ' <a class="file" data-file="' + esc(e.file) + '">' + esc(e.file) + '</a>' : '';
    const badge = t === 'msg' ? '' : '<span class="badge">' + esc(t) + '</span>';
    return '<div class="ev ' + esc(t) + (mine ? ' me' : '') + (toMe && !mine ? ' tome' : '') + '"><span class="t">' + esc(timeOf(e.ts)) + '</span><span class="a" style="color:' + color(e.from) + '">' + esc(e.from) + '</span>' + to + badge + file + (e.text ? ' <span class="txt">' + esc(e.text).replace(/\\n/g, '<br>') + '</span>' : '') + '</div>';
  }
  function renderAll() {
    const log = $('log');
    log.innerHTML = events.length ? events.map(row).join('') : '<div class="empty">Nada na sala ainda.<br>Os agentes aparecem aqui quando usarem a skill <b>squad-stream</b> nesta sala (<code>node bus.js init &lt;sala&gt; --active</code>).</div>';
    if ($('fScroll').checked) log.scrollTop = log.scrollHeight;
  }
  function append(list) {
    const log = $('log');
    if (!events.length) { events = list.slice(); renderAll(); return; }
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    for (const e of list) { events.push(e); const h = row(e); if (h) log.insertAdjacentHTML('beforeend', h); }
    if (events.length > 3000) { events = events.slice(-2000); renderAll(); return; }
    if ($('fScroll').checked && near) log.scrollTop = log.scrollHeight;
  }
  function send() {
    const txt = $('txt').value.trim();
    if (!txt) return;
    vscode.postMessage({ cmd: 'send', to: $('to').value, text: txt, type: $('isQ').checked ? 'question' : 'msg' });
    $('txt').value = ''; $('isQ').checked = false;
  }
  $('send').onclick = send;
  $('txt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('room').onchange = () => vscode.postMessage({ cmd: 'select', room: $('room').value });
  ['fEdit', 'fSys', 'fScroll'].forEach((id) => { $(id).onchange = renderAll; });
  $('log').addEventListener('click', (e) => { const a = e.target.closest('a.file'); if (a) vscode.postMessage({ cmd: 'open', file: a.dataset.file }); });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === 'rooms') {
      me = m.user || me; room = m.current;
      $('room').innerHTML = m.rooms.length ? m.rooms.map((r) => '<option value="' + esc(r) + '"' + (r === m.current ? ' selected' : '') + '>' + esc(r) + '</option>').join('') : '<option value="">(nenhuma sala)</option>';
      $('hint').textContent = 'como ' + me;
    } else if (m.type === 'reset') {
      agents.clear(); events = m.events || []; events.forEach(track); renderWho(); renderAll();
    } else if (m.type === 'events') {
      m.events.forEach(track); renderWho(); append(m.events);
    }
  });
  vscode.postMessage({ cmd: 'ready' });
</script></body></html>`;
}

function activate(context) {
  const rv = new RoomView(context);
  context.subscriptions.push(
    rv,
    vscode.window.registerWebviewViewProvider('squadRoom.view', rv, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('squadRoom.newRoom', () => rv.newRoom()),
    vscode.commands.registerCommand('squadRoom.focus', () => vscode.commands.executeCommand('squadRoom.view.focus')),
    vscode.commands.registerCommand('squadRoom.openLog', async () => {
      if (!rv.room || !fs.existsSync(logPath(rv.room))) { vscode.window.showInformationMessage('Squad Room: nenhuma sala selecionada.'); return; }
      await vscode.window.showTextDocument(vscode.Uri.file(logPath(rv.room)), { preview: true });
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
