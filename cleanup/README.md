# Cleanup — supporting files for the dead-code cleanup workstream

This directory holds files that support the cleanup passes described in
`docs/superpowers/specs/2026-04-27-dead-code-cleanup-design.md`.

- `vulture-allowlist.py` — names vulture sees as unused but are reached
  via decorators, dynamic dispatch, or framework conventions. Pass this
  file as an extra positional arg to vulture so it stays in the import
  graph.
- `pass1-findings.md` — generated during Pass 1 scan (see plan).

Pass 2 and Pass 3 will add their own findings files.
