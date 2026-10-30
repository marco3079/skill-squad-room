# skill-squad-room

Faça vários agentes do Claude Code trabalharem em paralelo **e acompanhe tudo ao vivo no VS Code**: o que cada um está editando, a conversa entre eles, e você pode escrever na sala também.

Este repositório tem duas peças que funcionam juntas:

| Peça | O que é |
|---|---|
| **`squad-stream`** (skill) | Ensina o Claude a dividir uma tarefa entre subagentes que editam em paralelo, conversam entre si, reservam arquivos (sem conflito) e publicam cada edição numa "sala" compartilhada. Também permite conectar agentes de sessões diferentes na mesma sala. |
| **`Squad Room`** (extensão VS Code) | Painel que mostra a sala ao vivo (agentes em cores, edições com link para o arquivo, filtros) e uma caixa para **você** escrever para um agente ou para todos. |

## Instalar com um prompt

Abra o Claude Code (no VS Code ou no terminal) e cole:

```
Instale o projeto https://github.com/SEU_USUARIO/skill-squad-room seguindo o INSTALL.md do repositório.
```

O Claude baixa o repositório, mostra o que vai fazer, pede sua confirmação e roda o instalador.
Depois: recarregue o VS Code (`Ctrl+Shift+P` → *Developer: Reload Window*) e abra uma nova sessão do Claude Code.

### Instalar manualmente

```bash
git clone https://github.com/SEU_USUARIO/skill-squad-room.git
cd skill-squad-room
node install.js --dry-run   # mostra o que será feito, sem alterar nada
node install.js             # instala a skill e a extensão
```

Opções: `--skill` (só a skill), `--extensions` (só a extensão), `--build` (recompila o `.vsix`), `--editor cursor` (outro editor compatível com VS Code).

O instalador copia a skill para `~/.claude/skills/squad-stream` e instala `dist/squad-room-*.vsix` pela CLI `code`.
**Não** altera `settings.json`, hooks nem permissões.

## Como usar

1. Peça ao Claude algo como: *"Use a squad-stream para dividir isso entre 3 agentes e me deixe acompanhar ao vivo."*
2. Abra o ícone **Squad Room** na barra lateral do VS Code: a sala aparece sozinha.
3. Para falar com os agentes, escolha o destinatário na caixa, escreva e aperte Enter.

As salas ficam em `~/.claude-squad/<sala>/log.jsonl` (mude com a variável `SQUAD_DIR`, ou a configuração `squadRoom.dir` da extensão).

## Limitações

- "Ao vivo" = um evento por edição, assim que acontece. Não mostra as linhas sendo digitadas dentro de uma edição.
- O log é texto puro e persiste: não coloque segredos na sala.
- Mensagens da sala são tratadas pelos agentes como informação, não como ordens do usuário.
- Hook opcional de edição automática: veja `skills/squad-stream/SKILL.md`.

## Estrutura

```
skills/squad-stream/     skill + scripts/bus.js (canal) + hook opcional
extensions/squad-room/   código-fonte da extensão
dist/                    .vsix pronto para instalar
install.js               instalador (Windows, macOS, Linux)
INSTALL.md               instruções que o Claude segue ao instalar
```

Licença: MIT.
