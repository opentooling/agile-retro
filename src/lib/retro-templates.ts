/**
 * Retrospective formats.
 *
 * Classic is the default — it is the format every board used before formats
 * were selectable, so facilitators who pick nothing get what they are used to.
 * Listed first, since the picker renders in array order.
 *
 * A board's columns are just rows in the `Column` table, so a format is only a
 * starting set of them. `type` drives the colour accent in the UI (see
 * `columnAccent` in components/RetroBoard.tsx) and is the stable identifier —
 * titles are display text and may be reworded without breaking anything.
 *
 * Types follow a rough sentiment convention so new formats pick up sensible
 * colours for free: *_POSITIVE reads green, *_NEGATIVE red, *_IMPROVE blue,
 * *_RISK amber.
 */

export type RetroTemplate = {
  id: string;
  name: string;
  description: string;
  columns: { title: string; type: string }[];
};

export const RETRO_TEMPLATES: RetroTemplate[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'What went well · what did not · what to improve',
    columns: [
      { title: 'What went well', type: 'WHAT_WENT_WELL' },
      { title: "What didn't go well", type: 'WHAT_DIDNT_GO_WELL' },
      { title: 'What should be improved', type: 'WHAT_SHOULD_BE_IMPROVED' },
    ],
  },
  {
    id: 'start-stop-continue',
    name: 'Start / Stop / Continue',
    description: 'Action-oriented: name the behaviours to change',
    columns: [
      { title: 'Start', type: 'START' },
      { title: 'Stop', type: 'STOP' },
      { title: 'Continue', type: 'CONTINUE' },
    ],
  },
  {
    id: 'mad-sad-glad',
    name: 'Mad / Sad / Glad',
    description: 'Surfaces how the sprint felt, not just what happened',
    columns: [
      { title: 'Mad', type: 'MAD_NEGATIVE' },
      { title: 'Sad', type: 'SAD_IMPROVE' },
      { title: 'Glad', type: 'GLAD_POSITIVE' },
    ],
  },
  {
    id: 'four-ls',
    name: '4Ls',
    description: 'Liked · Learned · Lacked · Longed for',
    columns: [
      { title: 'Liked', type: 'LIKED_POSITIVE' },
      { title: 'Learned', type: 'LEARNED_NEUTRAL' },
      { title: 'Lacked', type: 'LACKED_NEGATIVE' },
      { title: 'Longed for', type: 'LONGED_IMPROVE' },
    ],
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    description: 'Wind · anchors · rocks · island — good for planning ahead',
    columns: [
      { title: 'Wind (what pushes us)', type: 'WIND_POSITIVE' },
      { title: 'Anchors (what holds us back)', type: 'ANCHOR_NEGATIVE' },
      { title: 'Rocks (risks ahead)', type: 'ROCKS_RISK' },
      { title: 'Island (where we are heading)', type: 'ISLAND_IMPROVE' },
    ],
  },
];

export const DEFAULT_TEMPLATE_ID = 'classic';

/** Look up a template by id, falling back to the default format. */
export function templateById(id: string | null | undefined): RetroTemplate {
  return (
    RETRO_TEMPLATES.find((t) => t.id === id) ??
    RETRO_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!
  );
}
