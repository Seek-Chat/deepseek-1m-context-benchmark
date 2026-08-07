# Security Policy

## Reporting sensitive findings

After the public repository exists, use GitHub's private vulnerability-reporting channel for this repository. Do not open a public issue containing credentials, authorization material, session cookies, private URLs, cloud identifiers, account information, raw benchmark prompts, or raw provider responses.

Until a private reporting channel is enabled, report the existence of a concern through the site's public contact route without including the sensitive value itself. The maintainer can then establish a private channel.

## Supported release

Only the latest tagged release is supported. A data correction creates a new immutable tag; an existing dataset tag is never moved or silently replaced.

## Public-data boundary

The public dataset is rebuilt through an explicit field allowlist. Raw prompts, raw responses, raw streaming events, credentials, cloud resource identifiers, object-store locations, private request identifiers, account data, and local paths are excluded.
