/*
 * `/changelog` is the site's page again
 * — and each week's entry stands under it, so the word is refused
 * as a workspace's address. The list as migration 199 left it, and one
 * word. As with `agent-board` (migration 192), the check constraint is
 * `not valid`: a workspace that already has the word keeps it, so before
 * this goes live we confirm no workspace in production is called
 * "changelog".
 */
create or replace function workspace_slug_allowed(p_slug text) returns boolean
language sql immutable set search_path = public as $$
  select p_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and p_slug not in (
       'api', 'auth', 'mcp', 'health', 'assets', 'static', 'files', 'cdn',
       'invite', 'join', 'welcome', 'signup', 'signin', 'sign-in', 'sign-up',
       'login', 'logout', 'forgot', 'reset', 'oauth', 'admin', 'settings',
       'notifications', 'members', 'chat', 'search', 'projects', 'new',
       'help', 'about', 'pricing', 'blog', 'docs', 'status', 'www', 'app',
       'tuff', 'usetuff', 'sw', 'manifest', 'favicon', 'robots', 'sitemap',
       'privacy', 'terms', 'legal', 'verify',
       'compare', 'for', 'refunds', 'alternatives',
       'agent-board', 'appsumo', 'changelog')
$$;
