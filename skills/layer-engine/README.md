# Layer-Engine agent skill / Навык агента

[Main package](https://www.npmjs.com/package/@solcorp/layer) · [Skill](SKILL.md)

Copy this entire directory, including `references`, into the skills directory supported by your coding agent. Enable or invoke `layer-engine` according to that agent's instructions. Agents without skills support can read SKILL.md explicitly as project guidance. Do not copy only the first file: it links to the documentation map.

Скопируйте весь каталог вместе с `references` в каталог навыков вашего агента. Активируйте `layer-engine` средствами агента. Если навыки не поддерживаются, передайте SKILL.md как инструкции проекта. Навык не устанавливает зависимости и не разрешает публикацию, отправку секретов или production-изменения.

The skill guides architecture and API use, not code execution permissions. It finds version-matched documentation in the source checkout or `@solcorp/layer-docs/content`. Syntax V1 is not required for application developers. No IDE extension or skill is installed automatically by npm.
