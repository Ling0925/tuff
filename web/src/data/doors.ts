/**
 * Whether somebody may open Members. The
 * screen is the fourth switch's; somebody the owner lets connect agents
 * gets it all the same, with only the Agents tab.
 */
export function membersDoor(can: readonly string[]): boolean {
  return can.includes('members.read') || can.includes('agent.connect')
}

/**
 * Whether somebody may open the workspace's settings.
 *
 * Only somebody who may change something there: its owner (the switches,
 * and whatever the edition puts beside them), whoever reads the security log and the webhooks, or a member the
 * switches let bring people and projects in by importing. Asked of `can` from
 * `/api/me` in one place, so the menu, the drawer, More and the palette offer
 * the same door.
 */
export function workspaceDoor(can: readonly string[]): boolean {
  return (
    can.includes('workspace.billing') || can.includes('audit.read') || (can.includes('project.create') && can.includes('people.invite'))
  )
}
