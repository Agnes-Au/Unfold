import { readFileSync } from 'node:fs';
import { newDeviceToken } from './auth.js';
import { seed } from './seed.js';
import { purgeDeviceCloudData } from './purge.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../demo-edited.json', import.meta.url), 'utf8'),
);

export const FICTIONAL_DEMO_DEVICE_ID = 'dev_unfold_fictional_maya_v1';
export const FICTIONAL_DEMO_CASE_ID = FIXTURE.case.id;

/**
 * The demo's authored wall-clock times are Hong Kong time — the persona is a
 * Hong Kong student — while the app renders every timestamp in the device's
 * own zone. Building the instants as UTC instead showed 20:01 as 04:01.
 */
const DEMO_UTC_OFFSET_MINUTES = 8 * 60;
const ANCHOR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day the fixture's `daysAgo` offsets count back from.
 *
 * `daysAgo` alone resolves against "now", so the demo slid forward every time
 * it was seeded. The fixture's `anchorDate` pins the journey to one fixed
 * calendar, so it always renders the same dates. Without one it falls back to
 * today in the demo's timezone.
 */
function fixtureAnchor(now = new Date()) {
  if (ANCHOR_DATE.test(FIXTURE.anchorDate ?? '')) return FIXTURE.anchorDate;
  return new Date(now.getTime() + DEMO_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** The UTC instant of a fixture wall-clock time `daysAgo` before the anchor. */
function atOffset(anchor, daysAgo, time) {
  const [hour, minute] = time.split(':').map(Number);
  const [year, month, day] = anchor.split('-').map(Number);
  const wallClock = Date.UTC(
    year,
    month - 1,
    day - daysAgo,
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
  );
  return new Date(wallClock - DEMO_UTC_OFFSET_MINUTES * 60_000).toISOString();
}

function buildHistory(anchor) {
  const entries = FIXTURE.notes.map((note) => {
    const recordedAt = atOffset(anchor, note.daysAgo, note.time);
    const eventAt = atOffset(anchor, note.eventDaysAgo ?? note.daysAgo, note.eventTime ?? note.time);
    return { id: note.id, createdAt: recordedAt, eventAt, text: note.text };
  });
  const excerpts = entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.eventAt,
    recordedAt: entry.createdAt,
    text: entry.text,
  }));
  const messages = FIXTURE.messages.map((message) => ({
    ...message,
    createdAt: atOffset(anchor, message.daysAgo, message.time),
  }));
  return { entries, excerpts, messages };
}

/** The authored conversation's ids; anything else was added after seeding. */
const AUTHORED_MESSAGE_IDS = new Set(FIXTURE.messages.map((message) => message.id));

/**
 * Put the authored conversation first and anything added since — a visitor's
 * own message or a live worker reply — after it, so a new message reads at the
 * bottom of the demo even though the fixture's own dates run past today.
 * Non-demo cases carry no authored ids, so their order is unchanged.
 */
export function orderThread(messages) {
  const authored = messages.filter((message) => AUTHORED_MESSAGE_IDS.has(message.id));
  const added = messages.filter((message) => !AUTHORED_MESSAGE_IDS.has(message.id));
  return [...authored, ...added];
}

/**
 * Create only the namespaced fictional device, case, and messages. Existing
 * demo rows are never reset, so replies and withdrawals survive re-entry.
 *
 * The demo device has cloud organisation on, so the student app uploads
 * Maya's fixture notes through the ordinary sync route and the server-side
 * features (themes, summaries, Ask, analysis) run on them. Visitors' own notes
 * are never synced to this shared device (enforced in the client store).
 */
export function ensureFictionalDemo(db) {
  seed(db);
  // Databases created before the demo had cloud organisation keep their device row.
  db.prepare('UPDATE devices SET cloud_org = 1 WHERE id = ? AND cloud_org = 0').run(FICTIONAL_DEMO_DEVICE_ID);
  const anchor = fixtureAnchor();
  const createdAt = atOffset(anchor, FIXTURE.case.createdDaysAgo, FIXTURE.case.createdTime);
  const existingCase = db.prepare('SELECT created_at FROM cases WHERE id = ?').get(FICTIONAL_DEMO_CASE_ID);
  if (existingCase) {
    // Reseed only when the authored calendar changed (a new anchor, say), so a
    // visitor's replies and withdrawals survive every other entry. The device
    // row and its token are always kept.
    if (existingCase.created_at === createdAt) return;
    purgeDeviceCloudData(db, FICTIONAL_DEMO_DEVICE_ID);
  }

  const worker = db.prepare('SELECT * FROM workers WHERE email = ?').get('demo.worker@unfold.local');
  if (!worker?.verified) throw new Error('The local demo worker must be verified before seeding the fictional case.');

  const history = buildHistory(anchor);
  const claimedAt = atOffset(anchor, FIXTURE.case.claimedDaysAgo, FIXTURE.case.claimedTime);
  const continuedAt = atOffset(anchor, FIXTURE.case.continuedDaysAgo, FIXTURE.case.continuedTime);
  const token = newDeviceToken();

  const insert = db.transaction(() => {
    const existingDevice = db.prepare('SELECT id FROM devices WHERE id = ?').get(FICTIONAL_DEMO_DEVICE_ID);
    if (!existingDevice) {
      db.prepare('INSERT INTO devices (id, token, cloud_org, created_at) VALUES (?, ?, 1, ?)').run(
        FICTIONAL_DEMO_DEVICE_ID,
        token,
        createdAt,
      );
    }
    db.prepare(
      `INSERT INTO cases (id, device_id, main_concerns, recent_change, period, excerpts, topics, language,
                          status, claim_count, claimed_by, created_at, claimed_at, responded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'continued', 1, ?, ?, ?, ?, ?)`,
    ).run(
      FICTIONAL_DEMO_CASE_ID,
      FICTIONAL_DEMO_DEVICE_ID,
      FIXTURE.case.mainConcerns,
      FIXTURE.case.recentChange,
      FIXTURE.case.period,
      JSON.stringify(history.excerpts),
      JSON.stringify(FIXTURE.case.topics),
      FIXTURE.case.language,
      worker.id,
      createdAt,
      claimedAt,
      history.messages.find((message) => message.sender === 'worker').createdAt,
      continuedAt,
    );

    const insertMessage = db.prepare(
      `INSERT INTO messages (id, case_id, sender, sender_worker_id, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const message of history.messages) {
      insertMessage.run(
        message.id,
        FICTIONAL_DEMO_CASE_ID,
        message.sender,
        message.sender === 'worker' ? worker.id : null,
        message.text,
        message.createdAt,
      );
    }
  });
  insert();
}

/**
 * Rebuild the demo conversation from the fixture: delete the demo device's
 * cases and every message on them (including ones visitors sent), then
 * reseed. The device, its token and the synced fixture notes are kept, so a
 * reset doesn't reclassify Maya's notes.
 */
export function resetFictionalDemo(db) {
  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE case_id IN (SELECT id FROM cases WHERE device_id = ?)').run(FICTIONAL_DEMO_DEVICE_ID);
    db.prepare('DELETE FROM cases WHERE device_id = ?').run(FICTIONAL_DEMO_DEVICE_ID);
  })();
  ensureFictionalDemo(db);
}

/** A one-purpose session response for the fictional-only student demo. */
export function fictionalDemoSession(db) {
  const device = db.prepare('SELECT token FROM devices WHERE id = ?').get(FICTIONAL_DEMO_DEVICE_ID);
  const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(FICTIONAL_DEMO_CASE_ID);
  if (!device || !row) throw new Error('The fictional demo fixture was not initialized.');

  const excerpts = JSON.parse(row.excerpts || '[]');
  return {
    deviceToken: device.token,
    persona: FIXTURE.persona,
    entries: excerpts.map((excerpt) => ({
      id: excerpt.id,
      createdAt: excerpt.recordedAt ?? excerpt.createdAt,
      eventAt: excerpt.createdAt,
      transcript: excerpt.text,
      deidentified: excerpt.text,
      tokens: [],
    })),
    case: {
      id: row.id,
      createdAt: row.created_at,
      status: row.status,
      claimCount: row.claim_count,
      summary: {
        mainConcerns: row.main_concerns,
        recentChange: row.recent_change,
        period: row.period,
        tokens: [],
        excerpts,
      },
    },
  };
}
