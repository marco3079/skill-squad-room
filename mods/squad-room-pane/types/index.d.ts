export type Ev = {
  ts: string
  from: string
  to: string
  type: string
  file?: string
  text: string
  mentions?: string[]
}

export type RoomView = {
  /** Sala em exibição ('' = nenhuma encontrada). */
  room: string
  /** Todas as salas existentes em ~/.claude-squad. */
  rooms: string[]
  /** Últimos eventos do log da sala, do mais antigo ao mais novo. */
  events: Ev[]
}

export type UiState = {
  filter: 'all' | 'chat' | 'actions' | 'questions' | 'me'
  /** Agente usado como filtro ('' = todos). */
  agent: string
}

declare module 'claude-code' {
  interface PluginState {
    'squad-room-pane': {
      view: Shaped<RoomView>
      ui: Shaped<UiState>
    }
  }
}
