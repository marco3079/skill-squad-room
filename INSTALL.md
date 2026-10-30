# INSTALL.md — instruções para o Claude Code

> Este arquivo é lido pelo Claude quando o usuário pede para instalar este projeto. Siga os passos na ordem.

Este repositório contém a skill `squad-stream` e a extensão de VS Code `squad-room`.

## Passos

1. **Obtenha o repositório** (se ainda não estiver em disco): `git clone <url deste repositório>` numa pasta temporária ou de projetos do usuário e entre nela. Se o usuário já abriu esta pasta, pule.
2. **Simule** (não altera nada):
   ```bash
   node install.js --dry-run
   ```
   Resuma ao usuário em poucas linhas: copia a skill para `~/.claude/skills/squad-stream` e instala a extensão `squad-room` (de `dist/`) no VS Code. Não mexe em `settings.json`, hooks ou permissões.
3. **Peça confirmação** ao usuário. Só continue com um "sim" claro.
4. **Instale**:
   ```bash
   node install.js
   ```
   Se o comando `code` não for encontrado, mostre a mensagem do instalador ao usuário (não tente instalar o VS Code). Outro editor compatível: `--editor cursor`. Só uma parte: `--skill` ou `--extensions`. Recompilar o `.vsix` a partir do código: `--build` (precisa de Node/npm).
5. **Avise o usuário**: recarregar o VS Code (`Ctrl+Shift+P` → "Developer: Reload Window") e abrir uma nova sessão do Claude Code para a skill aparecer.

## Só Claude Code (sem VS Code)

Para quem não usa VS Code:

- **Via plugin** (o próprio usuário digita no Claude Code): `/plugin marketplace add marco3079/skill-squad-room` e `/plugin install squad-stream@skill-squad-room`. Depois, abrir o terminal da sala com `tui.js`.
- **Via este prompt de instalação**: rode `node install.js --dry-run --skill`, peça confirmação e rode `node install.js --skill` (sem extensão). **Só se o usuário pedir expressamente e confirmar**, rode `node install.js --hooks` (mescla o hook PostToolUse em `~/.claude/settings.json`, com backup `settings.json.bak-<data>`; `--remove-hooks` desfaz; use `--dry-run` antes). Nunca rode `--hooks` por conta própria.
- **Usar o terminal da sala**: em um segundo terminal, `node "<pasta-da-skill>/scripts/tui.js" <sala>` (padrão: `~/.claude/skills/squad-stream`). Imprima o comando exato para o usuário copiar; não o execute você mesmo (é interativo). Comandos: `/rooms`, `/room <nome>`, `/who`, `/actions on|off`, `/q`.

## Regras

- Não altere nenhuma configuração do usuário além do que o `install.js` faz.
- O hook de registro automático (`skills/squad-stream/scripts/hook-post-tool.js`) é **opcional**: explique-o e só adicione ao `settings.json` (`node install.js --hooks`) se o usuário pedir expressamente e confirmar.
- Não execute nada além de `git clone` e `node install.js` para instalar.
