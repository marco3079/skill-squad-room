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

## Regras

- Não altere nenhuma configuração do usuário além do que o `install.js` faz.
- O hook de edição automática (`skills/squad-stream/scripts/hook-post-edit.js`) é **opcional**: explique-o e só adicione ao `settings.json` se o usuário pedir expressamente.
- Não execute nada além de `git clone` e `node install.js` para instalar.
