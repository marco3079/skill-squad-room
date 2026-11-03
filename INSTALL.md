# INSTALL.md — instruções para o Claude Code

> Este arquivo é lido pelo Claude quando o usuário pede para instalar este projeto. Siga os passos na ordem.

Este repositório contém a skill `squad-stream` e a extensão de VS Code `squad-room`.

## Passos (instala tudo de uma vez: Claude Code desktop, terminal e VS Code)

Este repositório contém a skill `squad-stream`, o painel `/sala` do Claude Code desktop (plugin `squad-room-pane`) e a extensão `squad-room` do VS Code.

1. **Obtenha o repositório** (se ainda não estiver em disco): `git clone <url deste repositório>` numa pasta de projetos do usuário e entre nela. Se o usuário já abriu esta pasta, pule.
2. **Simule** (não altera nada): `node install.js --dry-run`. Resuma ao usuário em poucas linhas o que será instalado (a skill, a extensão do VS Code e o painel do Claude Code desktop).
3. **Faça UMA pergunta de confirmação** ao usuário: "Posso instalar tudo?" Pergunte também (na mesma mensagem) se quer o hook opcional de registro automático das ações dos agentes na sala (`--hooks`, mexe em `~/.claude/settings.json` com backup). Sem "sim" explícito, não use `--hooks`.
4. **Instale**: `node install.js`  (acrescente `--hooks` só se o usuário disse sim ao hook)
   - Sem o comando `code` no PATH, o instalador avisa e segue; não tente instalar o VS Code. Outro editor: `--editor cursor`.
   - Sem o comando `claude` no PATH, ele pula o painel e imprime o comando `/plugin install` para o usuário digitar.
   - Só uma parte: `--skill`, `--extensions` ou `--plugins`.
5. **Avise o usuário**: no Claude Code desktop rode `/reload-plugins` (ou abra nova sessão) e use `/sala`; no VS Code, `Ctrl+Shift+P` → "Developer: Reload Window".

## Só Claude Code (sem VS Code)

Para quem não usa VS Code:

- **Via plugin** (o próprio usuário digita no Claude Code): `/plugin marketplace add marco3079/skill-squad-room` e `/plugin install squad-stream@skill-squad-room`. Depois, abrir o terminal da sala com `tui.js`.
- **Via este prompt de instalação**: rode `node install.js --dry-run --skill`, peça confirmação e rode `node install.js --skill` (sem extensão). **Só se o usuário pedir expressamente e confirmar**, rode `node install.js --hooks` (mescla o hook PostToolUse em `~/.claude/settings.json`, com backup `settings.json.bak-<data>`; `--remove-hooks` desfaz; use `--dry-run` antes). Nunca rode `--hooks` por conta própria.
- **Usar o terminal da sala**: em um segundo terminal, `node "<pasta-da-skill>/scripts/tui.js" <sala>` (padrão: `~/.claude/skills/squad-stream`). Imprima o comando exato para o usuário copiar; não o execute você mesmo (é interativo). Comandos: `/rooms`, `/room <nome>`, `/who`, `/actions on|off`, `/q`.

## Regras

- Não altere nenhuma configuração do usuário além do que o `install.js` faz.
- O hook de registro automático (`skills/squad-stream/scripts/hook-post-tool.js`) é **opcional**: explique-o e só adicione ao `settings.json` (`node install.js --hooks`) se o usuário pedir expressamente e confirmar.
- Não execute nada além de `git clone` e `node install.js` para instalar.
