# Working on adobe-mcp

This folder is the handbook for anyone extending this repository: adding tools to an
application server, adding an application, or running a planned batch of work across
many contributors at once. It records how the code is organised, how work is planned
from the capability atlas, how changes land and ship, and what has been learned the
hard way.

Read in this order:

1. [architecture.md](architecture.md): packages, how each server reaches its
   application, the tool definition shape, the static audits.
2. [adding-tools.md](adding-tools.md): per-application rules for writing a tool and
   its tests.
3. [capability-atlas.md](capability-atlas.md): the private feature inventory every
   tool's `features` refer to, and how findings flow back into it.
4. [workflow.md](workflow.md): planning epics and tickets from the atlas, building them
   in parallel worktrees, landing the pull requests, closing tickets.
5. [releasing.md](releasing.md): tags, npm, the MCP Registry, and what is not yet
   published.
6. [status.md](status.md): where every application stands, what is unverified, and
   what is next.
7. [lessons.md](lessons.md): problems already met and how they were solved.

[briefs/](briefs/) holds a self-contained brief per application, written for one
person (or process) taking one epic. [scripts/](scripts/) holds the tools that plan
tickets, check them and land pull requests.

Tools that look for a `.agents/` folder can use this one through a local link, which
is ignored by git: `ln -s docs/handbook .agents`, then add `.agents` to
`.git/info/exclude`.

## Rules that apply to every change

- **Plain language.** Descriptions, docs, commit messages and PR text say what the
  change does, in plain words. No attribution lines, and nothing about how the work
  was produced.
- **Never bypass git hooks**, never force-push `main`, never merge with failing
  checks.
- **Every caller value reaches a script through the core helpers** (`str`, `num`,
  `index`, `bool`, `enumOf`, `json`, `jsxPath`); every caller path goes through the
  package's path policy first. Raw interpolation is a security bug.
- **No modal dialogs.** A script that opens a dialog blocks the application until the
  call times out. Use the object model, or record the feature as not scriptable.
- **Claim only what a tool performs.** A tool's `features` are atlas feature ids it
  actually carries out; tests check they exist.
- **Statically tested is not validated.** None of the servers has been run against
  the real applications on the machine they were built on. Say so in PRs, and
  record anything you were unsure of.
- **Don't delete what you didn't create.** Move unwanted files to the Trash; never
  `git worktree remove --force` (see [lessons.md](lessons.md)).
- **Keep durable working files out of `/tmp`.** It is wiped on reboot. Coordination
  files live in a work folder next to the checkout (see [workflow.md](workflow.md)).
