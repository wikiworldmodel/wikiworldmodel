# Security

## Reporting a vulnerability

Please report a security problem privately, not in a public issue: use **Report a vulnerability**
on the repository's Security tab (GitHub's private vulnerability reporting), or write to
security@wikiworldmodel.org. Say what you found, how to reproduce it, and what it could affect.
You should hear back within a week. Once a fix is out, the advisory credits you unless you would
rather it didn't.

## What counts

The site is static: the viewer runs in the visitor's browser and reads files from a CDN, with no
accounts and no server of its own. The things most worth reporting:

- **Code that runs in visitors' browsers from the world's data.** Generators in
  `world/generators/` run in the viewer, and records, sources and datasets are drawn as text and
  links. A record or a dataset that can make the viewer run script, load something from another
  host, or show HTML of its own is a vulnerability.
- **The build and CI.** A pull request that can reach the deployment's secrets, change what is
  published without review, or run code on CI beyond its checks.
- **The supply chain.** A pinned dataset or dependency that could be swapped: datasets are checked
  by sha256, and a way around that check matters.
- **The site's configuration**: its headers, its caching, and what it serves.

A wrong fact, however serious, is not a security problem: report it with the *Report a problem*
issue form, as [CONTRIBUTING.md](CONTRIBUTING.md) says.

## Supported versions

Only what `master` builds, and what wikiworldmodel.org serves, is supported.
