#!/usr/bin/env node
'use strict';
// Hook PostToolUse (matcher "*"): publica TODA ação do agente no grupo, automaticamente.
// Edições vão como (edit) com o trecho alterado; o resto (Bash, Read, Grep, buscas, MCP…) como (action).
// Sala: env SQUAD_ROOM ou o conteúdo de <SQUAD_DIR>/ACTIVE (criado por `bus.js init <sala> --active`).
// Nunca bloqueia nem falha a ferramenta: qualquer erro termina em exit 0.
// Segredos comuns (tokens, senhas, chaves) são mascarados antes de gravar; ainda assim o log é texto puro.

const fs = require('fs');
const path = require('path');

const SECRET = [
  /(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/g, // antes da regra de "authorization:" para não deixar o token para trás
  /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(\b(?:password|passwd|senha|secret|token|api[_-]?key|authorization)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi,
];
function redact(s) {
  let out = String(s == null ? '' : s);
  for (const re of SECRET) out = out.replace(re, (m, p1) => (p1 ? p1 + '***' : '***'));
  return out;
}
const clip = (s, n) => { s = redact(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const lines = (s) => (typeof s === 'string' && s.length ? s.split('\n').length : 0);

function describe(p) {
  const name = p.tool_name || 'tool';
  const ti = p.tool_input || {};
  const file = ti.file_path || ti.path || ti.notebook_path;
  switch (name) {
    case 'Edit':
      return { type: 'edit', file, text: `Edit −${lines(ti.old_string)} +${lines(ti.new_string)} | − ${clip(ti.old_string, 140)} | + ${clip(ti.new_string, 140)}` };
    case 'MultiEdit':
      return { type: 'edit', file, text: `MultiEdit (${Array.isArray(ti.edits) ? ti.edits.length : '?'} trechos)` };
    case 'Write':
      return { type: 'edit', file, text: `Write (${lines(ti.content)} linhas) | ${clip(ti.content, 160)}` };
    case 'NotebookEdit':
      return { type: 'edit', file, text: 'NotebookEdit' };
    case 'Bash':
      return { type: 'action', text: `$ ${clip(ti.command, 300)}` };
    case 'Read':
      return { type: 'action', file, text: 'Read' };
    case 'Grep':
      return { type: 'action', text: `Grep "${clip(ti.pattern, 100)}"${ti.path ? ' em ' + ti.path : ''}` };
    case 'Glob':
      return { type: 'action', text: `Glob ${clip(ti.pattern, 100)}` };
    case 'WebFetch':
      return { type: 'action', text: `WebFetch ${clip(ti.url, 200)}` };
    case 'WebSearch':
      return { type: 'action', text: `WebSearch "${clip(ti.query, 150)}"` };
    default:
      return { type: 'action', file, text: `${name} ${clip(JSON.stringify(ti), 200)}` };
  }
}

function resultLine(p) {
  const r = p.tool_response;
  if (r == null) return '';
  const failed = r && typeof r === 'object' && (r.is_error || r.error || (r.exit_code != null && r.exit_code !== 0) || r.interrupted);
  let s = typeof r === 'string' ? r : ((failed && (r.stderr || r.error)) || r.stdout || r.output || r.content || JSON.stringify(r));
  if (typeof s !== 'string') s = JSON.stringify(s);
  const t = clip(s, 160);
  return t ? ` → ${failed ? 'ERRO: ' : ''}${t}` : '';
}

try {
  const { post, ROOT } = require('./bus.js');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { process.exit(0); }
  const p = JSON.parse(raw || '{}');
  let room = process.env.SQUAD_ROOM;
  if (!room) {
    try { room = fs.readFileSync(path.join(ROOT, 'ACTIVE'), 'utf8').trim(); } catch (e) { process.exit(0); }
  }
  if (!room) process.exit(0);
  const d = describe(p);
  const agent = process.env.SQUAD_AGENT || p.agent_type || p.agent_id || 'agent';
  const extra = d.type === 'edit' ? '' : resultLine(p);
  post(room, { from: agent, type: d.type, file: d.file, text: d.text + extra });
} catch (e) { /* silencioso */ }
process.exit(0);
