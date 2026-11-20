/*
 * The public site's pages keep their addresses.
 *
 * `/compare`, `/for` and `/refunds` arrived without their words being
 * refused as a workspace's address, and `/alternatives` arrives now. A
 * workspace called "compare" would have been given `/compare`, which every
 * comparison's link already leads to. `pricing` and `about` were refused
 * from the start.
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
       'compare', 'for', 'refunds', 'alternatives')
$$;
