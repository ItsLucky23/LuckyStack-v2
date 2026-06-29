import { randomUUID } from 'node:crypto';

//? Contract-test mutation safety (finding #98). The contract sweep posts
//? generated sample payloads at every endpoint, which can create real rows.
//? Tagging generated string values with a recognizable, run-unique marker
//? makes any such row identifiable (so the reset bookends — and a human
//? scanning the DB — can tell test data from real data) and collision-free
//? (no chance a generated value matches an existing real record's field).

//? Fixed leading token every generated test string starts with. Stable across
//? runs so consumers / DB scans can match `lstest_*` to spot stray test data.
export const TEST_DATA_PREFIX = 'lstest_';

//? Build a run-unique marker like `lstest_a1b2c3d4_`. The short uuid segment
//? keeps two concurrent runs from generating colliding values while staying
//? short enough not to blow past typical string length limits.
export const createTestDataMarker = (): string => `${TEST_DATA_PREFIX}${randomUUID().slice(0, 8)}_`;
