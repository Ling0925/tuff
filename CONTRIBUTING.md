# Contributing

Thanks for wanting to help with Tuff. The short version:

- **Issues are very welcome**: bugs, ideas, questions about running it.
- **Pull requests aren't merged.** Please open an issue instead.

## Reporting a bug

Open a [bug report](https://github.com/usetuff/tuff/issues/new?template=bug.yml).
The form asks for your version, how you run Tuff and the logs, which is
usually what it takes to find the fault. Every report is read, and answered
as soon as we can.

A security problem goes privately, never into an issue: see [SECURITY.md](SECURITY.md).

## Asking for a feature

Open a [feature request](https://github.com/usetuff/tuff/issues/new?template=feature.yml)
and describe the problem you're trying to solve, not only the solution.
Tuff tries to stay small, so not everything gets built, but knowing what
people need is how we decide what does.

## Why no pull requests

Tuff is built by one person, and the same code runs
[usetuff.com](https://usetuff.com), a paid service. That leads to two reasons:

- **Licensing.** The service is built from this code, so every line in it
  has to be ours to license. A patch from someone else would need a
  contributor agreement, and we'd rather not ask anyone to sign one.
- **Time.** Checking a stranger's change for safety, design and tests takes
  longer than making the change ourselves.

So when you report a bug, we fix it in our own code, and the fix arrives
here like every other commit. Please don't attach a patch you want merged;
a clear description, the steps to reproduce it and your logs help more.
A pull request that is opened is closed automatically, with a link back to
Issues. It's nothing personal.

## Forking

The code is [AGPL-3.0-only](LICENSE). You're free to fork it, change it and
run it, under the licence's terms: if you offer your changed version to
others over a network, publish your changes. Please give your fork another
name: the name Tuff and its logo aren't covered by the licence.
