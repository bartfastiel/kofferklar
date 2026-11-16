// Records as stored in IndexedDB and synced with the server (store name → type).

export interface Base {
  id: string;
  /** set on every local change (ms); the newer change wins when syncing */
  updated?: number;
  /** tombstone: deleted, kept so other devices learn about it */
  deleted?: boolean;
}

/** 1 = unverzichtbar, 2 = wichtig, 3 = optional */
export type Priority = 1 | 2 | 3;

/** how many to pack: ceil(days or nights / every) + add, at least 1, at most max */
export interface Quantity {
  per: 'day' | 'night';
  every?: number;
  add?: number;
  max?: number;
}

/** something to pack (store `items`) */
export interface Item extends Base {
  name: string;
  category: string;
  priority: Priority;
  /**
   * when the item is suggested: any of the groups matches if the trip has all its tags; an empty list means always.
   * Example: [['angeln'], ['zelt']] = when fishing or when camping.
   */
  when: string[][];
  /** never suggested when the trip has one of these tags (e.g. a storm lighter on a flight) */
  unless: string[];
  qty?: Quantity;
  note?: string;
  /** only for this one trip (added on the spot, not learned) */
  trip?: string;
  created: number;
}

/** the configurator's answers; tags are derived from them (src/plan.ts) */
export interface Answers {
  kind: string;
  nights: number;
  /** single choices (destination, accommodation) and multiple choices (travel, weather, activities, people) */
  pick: Record<string, string[]>;
}

/** one trip with its answers and what has been packed (store `trips`) */
export interface Trip extends Base {
  title: string;
  answers: Answers;
  /** item ids already packed */
  checked: Record<string, true>;
  /** item ids not needed this time */
  skipped: Record<string, true>;
  /** first day of the trip (YYYY-MM-DD), optional */
  start?: string;
  /** done: the trip is over, it moves down in the list */
  done?: boolean;
  created: number;
}

export interface Author {
  id: string;
  name: string;
}
