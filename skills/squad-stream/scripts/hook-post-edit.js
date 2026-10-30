#!/usr/bin/env node
'use strict';
// Hook PostToolUse (Edit|Write|MultiEdit): publica cada edição no canal, automaticamente.
// Sala: env SQUAD_ROOM ou o conteúdo de <SQUAD_DIR>/ACTIVE (criado por `bus.js init <sala> --active`).
// Nunca bloqueia nem falha a ferramenta: qualquer erro termina em exit 0.

const fs = require('fs');
const path = require('path');

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
  const ti = p.tool_input || {};
  const file = ti.file_path || ti.path;
  if (!file) process.exit(0);
  const lines = (s) => (typeof s === 'string' && s.length ? s.split('\n').length : 0);
  let summary = p.tool_name || 'edit';
  if (p.tool_name === 'Edit') summary += ` −${lines(ti.old_string)} +${lines(ti.new_string)} linhas`;
  else if (p.tool_name === 'Write') summary += ` (${lines(ti.content)} linhas)`;
  else if (p.tool_name === 'MultiEdit' && Array.isArray(ti.edits)) summary += ` (${ti.edits.length} trechos)`;
  const agent = process.env.SQUAD_AGENT || p.agent_type || p.agent_id || 'agent';
  post(room, { from: agent, type: 'edit', file, text: summary });
} catch (e) { /* silencioso */ }
process.exit(0);
