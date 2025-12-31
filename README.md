# Embed Metadata
Render frontmatter metadata (Obsidian Properties) inside your notes with a lightweight inline `[%key]` or `{{key}}` syntax.

The intent for developing this is as a lightweight replacement for Dataviews `=this.key` embedded metadata rendering, specifically if [Obsidian Bases](https://help.obsidian.md/bases) cover most everything else.

## Usage
Add frontmatter (Properties) to a note:

```yaml
---
title: Stay out of the sun!
tags:
  - Alexander
  - Cynic
author_name: Diogenes
---
```

Then reference it in the note body:

```markdown
What do you think of [%title] as book title?
We recommend using those tags: [%tags]
The Author called [%author_name] is really funny!
```

The tokens are replaced in reading view and live preview. Source mode keeps
the token as plain text. If a key is missing, the token is left unchanged.
Inline code and code blocks are ignored in preview.## Settings

Use **Settings → Community plugins → Embed Metadata** to choose the token
format: `[%key]` or `{{key}}`.

Visual look options apply in Live Preview:
- Bold / Italic / Underline toggles
- Optional underline color override (defaults to text color)
- Optional highlight with theme color or override
- Hover emphasis (subtle style shift on hover)

Note: Obsidian Properties do not support nested properties in Reading view or Live Preview.
If you use nested YAML, use Source mode to view them, or flatten keys (for example,
`author_name`).

## Settings
### Syntax used
Use **Settings → Community plugins → Embed Metadata** to choose the token
format: `[%key]` or `{{key}}`.

### Visual settings
Visual look options apply in Live Preview:
- Bold / Italic / Underline toggles
- Optional underline color override (defaults to text color)
- Optional highlight with theme color or override
- Hover emphasis (subtle style shift on hover)

## Autocomplete
Type the configured opener (`[%` or `{{`) to see a dropdown of frontmatter keys
from the current file. Results are sorted alphabetically and update as you type.

## Disclaimer
AI was used during the development of this project.
