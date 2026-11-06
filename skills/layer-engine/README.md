# Layer-Engine agent skill

[Main package](https://www.npmjs.com/package/@solcorp/layer) · [Skill instructions](SKILL.md) · [Documentation map](references/documentation-map.md)

Use this skill with a coding agent to build offline-capable, cross-platform Layer-Engine applications. It prioritizes reactive DOM updates, reusable components, the standard project layout and managed storage, navigation and API contracts.

Copy this entire directory, including `references`, into the skills directory supported by your agent. Enable or invoke `layer-engine` according to that agent's instructions. Agents without skill support can read `SKILL.md` explicitly as project guidance. Copying only `SKILL.md` omits its documentation map.

The instructions are in English. The skill finds the handbook matching the application's installation in the source checkout or `@solcorp/layer-docs/content`. Detailed methods, parameters and examples come from that local handbook. It prefers English documentation and can fall back to the corresponding Russian article. The agent can respond in your preferred language.

The skill works independently of Syntax V1. It follows your project's coding style unless you separately request another style. npm does not automatically install this skill or an IDE extension.

Version `2026.11.06.1` identifies these instructions. Feature availability comes from the installed framework version. Using the skill does not grant permission to publish packages, deploy an application, modify production data or transfer secrets.
