# The window's title

The tab says where you are, the way Linear's does — `Loops › My loops`
there, here:

- a project and its tool: `Acme rebrand › Tasks`, `Acme rebrand › Chat`;
- a task open: its handle and title, `ACM-41 Homepage hero, second pass`;
- a room from the sidebar: `# acme-rebrand-main`, or the person a direct
  conversation is with;
- the members screen, and the person on it: `Members › Robin`;
- My tasks, Projects, Settings, Notifications by their names.

No product name after it: the icon beside the title already says which
product, and a tab is narrow — what is cut off should be the product's name,
not the place.

Two writers, one store (`data/title.ts`): the shell says the place and an
open task says itself, and the task wins while it is open. Kept in one place
because effects run child first — written separately, the shell's title
would overwrite the task's the moment both changed together.
