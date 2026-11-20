/*
 * `/privacy` is the product's privacy policy — and
 * `/terms` is where its terms will stand. A workspace given either address
 * would have had its link open the policy instead, so both join the words
 * the app's own pages stand at.
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
       'privacy', 'terms', 'legal')
$$;
