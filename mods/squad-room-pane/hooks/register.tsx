import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Ev, RoomView, UiState } from '../types'

const PANE = 'sala'
const ACTION_TYPES = ['action', 'edit', 'claim', 'release']
const QUIET_TYPES = ['system', 'join', 'leave']

// Mude a etiqueta quando os campos mudarem: ela descarta o que uma versão antiga guardou.
const view = atom(
  { plugin: 'squad-room-pane', key: 'view' } as const,
  { room: '', rooms: [], events: [] } as RoomView,
  { shape: 'view-2' },
)
const ui = atom(
  { plugin: 'squad-room-pane', key: 'ui' } as const,
  { filter: 'chat', agent: '' } as UiState,
  { shape: 'ui-2' },
)

// Nome escolhido com "/sala <nome>" (vazio = a sala ativa ou a mais recente).
let chosen = ''
let lastSig = ''
let seenTs = ''
let isPrimed = false

let HOME = ''
async function initHome($: any): Promise<void> {
  if (HOME) return
  const h = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  HOME = String(h).split(String.fromCharCode(92)).join('/')
}
function homeOf(root: string): string {
  if (HOME) return HOME
  const r = root.split('\\').join('/')
  const i = r.indexOf('/.claude/')
  return i >= 0 ? r.slice(0, i) : ''
}
const squadDir = (root: string) => `${homeOf(root)}/.claude-squad`
const busPath = (root: string) => `${homeOf(root)}/.claude/skills/squad-stream/scripts/bus.js`

function hue(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
function colorOf(name: string): string {
  const h = hue(name) / 360
  const s = 0.65
  const l = 0.62
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function parse(line: string): Ev {
  try {
    const e = JSON.parse(line)
    return {
      ts: String(e.ts ?? ''),
      from: String(e.from ?? '?'),
      to: String(e.to ?? 'all'),
      type: String(e.type ?? 'msg'),
      file: e.file ? String(e.file) : undefined,
      text: String(e.text ?? ''),
      mentions: Array.isArray(e.mentions) ? e.mentions.map(String) : undefined,
    }
  } catch {
    return { ts: '', from: '?', to: 'all', type: 'raw', text: line }
  }
}

function clock(ts: string): string {
  const m = /T(\d\d:\d\d:\d\d)/.exec(ts)
  return m ? m[1] : ''
}

async function pickRoom($: any, dir: string): Promise<string> {
  if (chosen) return chosen
  const active = (await $.fs.read(`${dir}/ACTIVE`).catch(() => '')) as string
  if (active.trim()) return active.trim()
  const entries = (await $.fs.list(dir).catch(() => [])) as Array<{ name: string; kind: string; mtimeMs: number }>
  let best = ''
  let bestMs = -1
  for (const en of entries) {
    if (en.kind === 'file') continue
    const st = await $.fs.stat(`${dir}/${en.name}/log.jsonl`).catch(() => undefined)
    if (st && st.mtimeMs > bestMs) { best = en.name; bestMs = st.mtimeMs }
  }
  return best
}

async function refresh($: any, root: string): Promise<void> {
  const dir = squadDir(root)
  const room = await pickRoom($, dir)
  let events: Ev[] = []
  if (room) {
    const text = (await $.fs.read(`${dir}/${room}/log.jsonl`).catch(() => '')) as string
    events = text.split('\n').filter(Boolean).slice(-300).map(parse)
  }
  const entries = (await $.fs.list(dir).catch(() => [])) as Array<{ name: string; kind: string }>
  const rooms = entries.filter(en => en.kind !== 'file').map(en => en.name).sort()
  const last = events[events.length - 1]
  const sig = `${rooms.join(',')}|${room}:${events.length}:${last ? last.ts + last.text.length : ''}`
  if (sig === lastSig) return
  lastSig = sig
  await update($, view, () => ({ room, rooms, events }))

  // Resumo na barra de status: sala e quantidade de agentes que já falaram.
  const agents = new Set(events.filter(e => !['user', 'main'].includes(e.from)).map(e => e.from))
  $.ui.status(room ? `sala ${room} · ${agents.size} agente${agents.size === 1 ? '' : 's'}` : undefined)

  // Aviso quando alguém menciona você; o primeiro carregamento não avisa do histórico.
  const newest = last ? last.ts : ''
  if (isPrimed) {
    for (const e of events) {
      if (e.ts > seenTs && e.from !== 'user' && (e.mentions ?? []).some(m => m === 'user' || m === 'main')) {
        $.ui.toast(`${e.from}: ${e.text.replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    }
  }
  if (newest) seenTs = newest > seenTs ? newest : seenTs
  isPrimed = true
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// Faixa de destaque (só nas superfícies gráficas): sala, avatares dos agentes e quatro números.
function heroSvg(room: string, people: Array<[string, AgentInfo]>, total: number, mentions: number, questions: number, colorOf: (n: string) => string): string {
  const W = 640
  const tiles: Array<[string, number, string]> = [
    ['AGENTES', people.length, '#61afef'], ['EVENTOS', total, '#c678dd'],
    ['PARA VOCÊ', mentions, '#e5c07b'], ['PERGUNTAS', questions, '#e06c75'],
  ]
  const tileSvg = tiles.map(([label, n, c], i) => {
    const x = 20 + i * 152
    return `<rect x="${x}" y="78" width="140" height="56" rx="12" fill="#ffffff" fill-opacity="0.07"/>` +
      `<text x="${x + 14}" y="102" font-family="Segoe UI,Arial" font-size="10" letter-spacing="1" fill="#abb2bf">${label}</text>` +
      `<text x="${x + 14}" y="125" font-family="Segoe UI,Arial" font-size="22" font-weight="700" fill="${c}">${n}</text>`
  }).join('')
  const avatars = people.slice(0, 8).map(([name], i) =>
    `<circle cx="${W - 34 - i * 26}" cy="36" r="13" fill="${colorOf(name)}" stroke="#1e2130" stroke-width="2"/>` +
    `<text x="${W - 34 - i * 26}" y="41" text-anchor="middle" font-family="Segoe UI,Arial" font-size="12" font-weight="700" fill="#1e2130">${esc(name.slice(0, 1).toUpperCase())}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 150" width="${W}">` +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a49"/><stop offset="1" stop-color="#3b2a5c"/></linearGradient></defs>' +
    `<rect width="${W}" height="150" rx="18" fill="url(#g)"/>` +
    '<circle cx="34" cy="36" r="6" fill="#98c379"/><circle cx="34" cy="36" r="11" fill="#98c379" fill-opacity="0.25"/>' +
    `<text x="56" y="43" font-family="Segoe UI,Arial" font-size="22" font-weight="700" fill="#ffffff">${esc(room || 'Nenhuma sala')}</text>` +
    '<text x="56" y="60" font-family="Segoe UI,Arial" font-size="11" fill="#98c379">ao vivo · sala dos agentes</text>' +
    avatars + tileSvg + '</svg>'
}

const ICON: Record<string, string> = {
  msg: '💬', question: '❓', answer: '✅', edit: '✏️', claim: '🔒', release: '🔓',
  action: '⚙️', status: '📌', done: '🏁', note: '📝',
}
const FILTERS: Array<{ id: UiState['filter']; label: string }> = [
  { id: 'chat', label: '💬 Conversa' },
  { id: 'all', label: 'Tudo' },
  { id: 'actions', label: '⚙️ Ações' },
  { id: 'questions', label: '❓ Dúvidas' },
  { id: 'me', label: '★ Você' },
]
const isMe = (ev: Ev) => (ev.mentions ?? []).some(m => m === 'user' || m === 'main')
const short = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const passes = (ev: Ev, f: UiState['filter']) =>
  f === 'all' ? true
    : f === 'chat' ? ['msg', 'answer', 'question', 'done', 'status', 'note'].includes(ev.type)
      : f === 'actions' ? ACTION_TYPES.includes(ev.type) || ev.type === 'status'
        : f === 'questions' ? ev.type === 'question' || ev.type === 'answer'
          : isMe(ev)

type AgentInfo = { n: number; last: Ev; files: Set<string> }

function rosterOf(events: Ev[]): Map<string, AgentInfo> {
  const m = new Map<string, AgentInfo>()
  for (const ev of events) {
    if (['user', 'main', '?'].includes(ev.from) || ev.type === 'raw') continue
    const a = m.get(ev.from) ?? { n: 0, last: ev, files: new Set<string>() }
    a.n++
    if (!QUIET_TYPES.includes(ev.type)) a.last = ev
    if (ev.type === 'claim' && ev.file) a.files.add(ev.file)
    if ((ev.type === 'release' || ev.type === 'done') && ev.file) a.files.delete(ev.file)
    m.set(ev.from, a)
  }
  return m
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sala',
      description: 'Abre o painel da sala dos agentes (/sala <nome> troca de sala)',
    })
    await $.command.register({ name: 'squad', description: 'Atalho de /sala' })
    await initHome($)
    const root = $.plugin.root
    void refresh($, root)
    $.clock.every(1500, () => { void refresh($, root) })
    return next(e)
  })

  for (const cmd of ['sala', 'squad']) on('command.run', { command: cmd }, async ($, e) => {
    await initHome($)
    const arg = e.args.trim()
    if (arg) { chosen = arg; lastSig = '' }
    await refresh($, $.plugin.root)
    const opened = await $.ui.open({ id: PANE, title: 'Sala dos agentes', focus: true })
    return {
      text: opened.isPlaced
        ? 'Painel da sala aberto.'
        : 'Não há espaço para o painel agora: aumente a janela ou rode /sala de novo.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Svg } = $.ui.resolve(e) as any
    const v = await read($, view)
    const u = await read($, ui)
    const BLUE = '#61afef'
    const YELLOW = '#e5c07b'
    const GREEN = '#98c379'

    const roster = rosterOf(v.events)
    const people = Array.from(roster.entries())
    const mentions = v.events.filter(isMe).length
    const questions = v.events.filter(ev => ev.type === 'question').length
    const rows = Math.max(4, (e.viewport?.rows ?? 28) - 12 - people.length * 2 - (v.rooms.length > 1 ? 2 : 0))

    const visible = v.events
      .filter(ev => !QUIET_TYPES.includes(ev.type))
      .filter(ev => passes(ev, u.filter))
      .filter(ev => !u.agent || ev.from === u.agent || (ev.mentions ?? []).includes(u.agent))
    const shown = visible.slice(-rows)
    const hidden = visible.length - shown.length

    const countOf = (f: UiState['filter']) =>
      v.events.filter(ev => !QUIET_TYPES.includes(ev.type) && passes(ev, f)).length

    const setFilter = (f: UiState['filter']) => () => { void update($, ui, cur => ({ ...cur, filter: f })) }
    const pickAgent = (name: string) => () => {
      void update($, ui, cur => ({ ...cur, agent: cur.agent === name ? '' : name }))
    }
    const pickRoom = (name: string) => () => { chosen = name; lastSig = ''; void refresh($, $.plugin.root) }

    const send = async (value: string) => {
      const text = value.trim()
      if (!text || !v.room) return
      await $.process.run(
        ['node', busPath($.plugin.root), 'post', v.room, '--from', 'user', '--type', 'msg', '--text', text],
        { env: { SQUAD_DIR: squadDir($.plugin.root) } },
      )
      lastSig = ''
      await refresh($, $.plugin.root)
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={BLUE} paddingX={1} gap={1}>
        {Svg && v.room ? (
          <Svg
            source={heroSvg(v.room, people, v.events.length, mentions, questions, colorOf)}
            alt={`Sala ${v.room}: ${people.length} agentes, ${v.events.length} eventos`}
          />
        ) : (
          <Box>
            <Text bold color={BLUE}>{v.room ? `💬 Sala · ${v.room}` : '💬 Nenhuma sala encontrada'}</Text>
            {v.room ? <Text color={GREEN}>  ● ao vivo</Text> : null}
          </Box>
        )}
        {!v.room && (
          <Text dimColor>Peça ao Claude para usar a squad-stream; a sala aparece aqui sozinha.</Text>
        )}
        {v.room && !Svg ? (
          <Text dimColor>
            {people.length} agente{people.length === 1 ? '' : 's'} · {v.events.length} eventos ·{' '}
            <Text color={mentions ? YELLOW : undefined} dimColor={!mentions}>★ {mentions} para você</Text> ·{' '}
            <Text color={questions ? YELLOW : undefined} dimColor={!questions}>❓ {questions} perguntas</Text>
          </Text>
        ) : null}

        {v.rooms.length > 1 && (
          <Box flexWrap="wrap" gap="xs">
            <Text dimColor>Salas: </Text>
            {v.rooms.map(r => (
              <Button key={`room:${r}`} variant={r === v.room ? 'primary' : 'secondary'} onPress={pickRoom(r)}>{r}</Button>
            ))}
          </Box>
        )}

        {people.length > 0 && (
          <Box flexDirection="column">
            <Text weight="bold" size="heading">Agentes <Text dimColor size="caption">(clique para filtrar)</Text></Text>
            {people.map(([name, a]) => (
              <Box flexDirection="column">
                <Button key={`ag:${name}`} plain onPress={pickAgent(name)}>
                  <Text color={colorOf(name)} bold>{u.agent === name ? '▸ ' : '● '}{name}</Text>
                  <Text dimColor> · {a.n} eventos</Text>
                  {a.files.size > 0 ? <Text color={YELLOW}> 🔒 {Array.from(a.files).slice(0, 2).join(', ')}</Text> : null}
                </Button>
                <Text dimColor>   {ICON[a.last.type] ?? '•'} {short(a.last.text, 70)}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexWrap="wrap" gap="xs">
          {FILTERS.map(f => (
            <Button key={`flt:${f.id}`} variant={u.filter === f.id ? 'primary' : 'secondary'} onPress={setFilter(f.id)}>
              {f.label} {countOf(f.id)}
            </Button>
          ))}
        </Box>
        {u.agent ? <Text color={colorOf(u.agent)}>Filtrando por {u.agent} (clique no agente de novo para limpar)</Text> : null}

        <Box flexDirection="column" borderStyle="single" borderColor="#4b5263" paddingX={1}>
          {shown.length === 0 ? <Text dimColor>Nada por aqui ainda.</Text> : null}
          {hidden > 0 ? <Text dimColor>↑ {hidden} eventos mais antigos</Text> : null}
          {shown.map(ev => {
            const quiet = ACTION_TYPES.includes(ev.type)
            return (
              <Text dimColor={quiet}>
                <Text dimColor>{clock(ev.ts)} </Text>
                <Text>{ICON[ev.type] ?? '•'} </Text>
                <Text color={colorOf(ev.from)} bold>{ev.from}</Text>
                {isMe(ev) ? <Text color={YELLOW} bold> ★</Text> : null}
                <Text dimColor> › </Text>
                {ev.file ? <Text color={BLUE}>{ev.file.split(/[\/]/).pop()} </Text> : null}
                <Text color={ev.type === 'question' ? YELLOW : ev.type === 'answer' ? GREEN : undefined}>
                  {short(ev.text, quiet ? 90 : 400)}
                </Text>
              </Text>
            )
          })}
        </Box>

        <Input
          key="msg"
          placeholder="Escreva no grupo… (use @agente para mencionar)"
          submitLabel="enviar"
          onSubmit={value => { void send(value) }}
        />
      </Box>
    )
  })
}
