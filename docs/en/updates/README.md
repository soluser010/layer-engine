---
title: Layer-Engine update history
description: Changes in each version and how to update your application.
audience: all
order: 100
status: documented
updated: 2026-11-04
---

# Layer-Engine update history

These notes explain changes that matter when developing applications: new behavior, settings, and upgrade steps. The rest of the handbook describes current APIs; this folder preserves their release history.

| Version | Main changes |
| --- | --- |
| [0.1.2](0.1.2.md) | First-install PWA screen, compact update card, and handbook release history |
| [0.1.1](0.1.1.md) | Offline RU/EN documentation, `layer guide`, and clearer package descriptions |
| [0.1.0](0.1.0.md) | First published version of the complete package set |

Version 0.1.2 is prepared for publication. A page on GitHub does not mean the version is already available on npm. Check availability with `npm view @solcorp/layer@0.1.2 version`. An install without a version uses the separately maintained `latest` tag.

Read the target version's notes, update your application's dependency, then rebuild `dist`. Do not replace individual files in an existing production bundle.

[Handbook contents](../README.md) · [Installation](../installation-cli.md) · [PWA updates](../application-updates.md)
