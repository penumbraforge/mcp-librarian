---
name: getting-started
version: 1.0.0
category: [mcp-librarian, guide]
description: How to use mcp-librarian — search, create, and share skills
---

## Quick Reference

mcp-librarian gives your AI agent a searchable library of skill files. Here's what you can do:

### Search Your Library

```
find_skill({ query: "authentication patterns" })
```

Returns ranked results with relevance scores and snippets.

### Load a Skill

```
load_skill({ skill: "getting-started" })
```

Returns the full skill content. Use `load_section` for a specific part:

```
load_section({ skill: "getting-started", section: "quick-reference" })
```

### Create a Skill

Ask your AI agent:

> "Create a skill about [your topic], using [source] as the primary reference"

The agent will research the topic and call `create_skill` to save it.

### Install Packs

```
install_pack({ pack: "penumbraforge/starter-pack" })
```

Downloads, validates, and deduplicates skills from community packs.

## Writing Good Skills

### Structure

Every skill needs YAML frontmatter with 4 fields:

```yaml
---
name: my-skill
version: 1.0.0
category: [relevant, tags]
description: One-line summary for search results
---
```

Use `##` for major sections, `###` for sub-sections. Each section is independently loadable.

### Tips

- Write for developers who need actionable patterns, not tutorials
- Include code examples in fenced blocks with language tags
- Keep each section self-contained — it may be loaded independently
- Use `validate_skill` to check your content before saving

## Sharing Skills

Export your skills as a pack:

```
export_pack({ name: "my-pack", description: "My team's patterns" })
```

This writes a `pack.json` and all skill files to `~/.mcp-librarian/exports/my-pack/`. Push that directory to GitHub and others can install it.
