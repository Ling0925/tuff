# Security

## Reporting a vulnerability

Please report a vulnerability privately, not in a public issue:

- **On GitHub:** open [Report a vulnerability](https://github.com/usetuff/tuff/security/advisories/new)
  (the **Security** tab of this repository → **Report a vulnerability**). Only the
  maintainers can see it.
- **By email:** hello@usetuff.com.

Tell us what you found, how to reproduce it, and what someone could do with it.
You'll hear back within a week, and we'll keep you posted until it's fixed. If
you'd like credit in the advisory, say how you'd like to be named.

## How a fix comes out

The same code runs [usetuff.com](https://usetuff.com), so a fix goes live there
first and then comes here, in a new release. Its commit and its changelog entry
say what was fixed, not how to exploit it. Once the release is out, we publish a
GitHub security advisory for it.

## Supported versions

Only the latest release gets fixes. Releases follow semantic versioning, so
moving to the latest within your major version never needs anything by hand:

```bash
scripts/update.sh
```

It backs up the database first. Watch this repository's releases (**Watch →
Custom → Releases**) to hear about new ones.

## In scope

The code in this repository: the server, the web app, the Docker image and the
compose setup. Problems that come from how a particular server is run — an
open database port, a weak password in `.env`, a proxy that passes a forged
`X-Forwarded-For` — are worth telling the person who runs it; [`docs/self-hosting.md`](docs/self-hosting.md)
says how to avoid them.
