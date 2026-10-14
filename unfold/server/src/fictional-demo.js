import { readFileSync } from 'node:fs';
import { newDeviceToken } from './auth.js';
import { seed } from './seed.js';
import { purgeDeviceCloudData } from './purge.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../demo-edited.json', import.meta.url), 'utf8'),
);

export const FICTIONAL_DEMO_DEVICE_ID = 'dev_unfold_fictional_maya_v1';
export const FICTIONAL_DEMO_CASE_ID = FIXTURE.case.id;

function atOffset(now, daysAgo, time) {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days to move the authored timeline back so that nothing in it is in
 * the future. A fixture authored with offsets past "now" (negative daysAgo, or
 * a later time today) would otherwise sort ahead of every new message.
 */
function timelineShiftDays(now) {
  const offsets = [
    ...FIXTURE.notes.flatMap((note) => [
      [note.daysAgo, note.time],
      [note.eventDaysAgo ?? note.daysAgo, note.eventTime ?? note.time],
    ]),
    ...FIXTURE.messages.map((message) => [message.daysAgo, message.time]),
    [FIXTURE.case.createdDaysAgo, FIXTURE.case.createdTime],
    [FIXTURE.case.claimedDaysAgo, FIXTURE.case.claimedTime],
    [FIXTURE.case.continuedDaysAgo, FIXTURE.case.continuedTime],
  ];
  const latest = Math.max(...offsets.map(([daysAgo, time]) => Date.parse(atOffset(now, daysAgo, time))));
  return latest > now.getTime() ? Math.ceil((latest - now.getTime()) / DAY_MS) : 0;
}

function buildHistory(now) {
  const entries = FIXTURE.notes.map((note) => {
    const recordedAt = atOffset(now, note.daysAgo, note.time);
    const eventAt = atOffset(now, note.eventDaysAgo ?? note.daysAgo, note.eventTime ?? note.time);
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
    createdAt: atOffset(now, message.daysAgo, message.time),
  }));
  return { entries, excerpts, messages };
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
  const existingCase = db.prepare('SELECT * FROM cases WHERE id = ?').get(FICTIONAL_DEMO_CASE_ID);
  if (existingCase) {
    // Repair a demo seeded before timeline shifting: future-dated messages
    // sort after every new one, hiding it. Reseed the demo device's case and
    // synced notes; the device row and its token are kept.
    const future = db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE case_id = ? AND created_at > ?')
      .get(FICTIONAL_DEMO_CASE_ID, new Date().toISOString()).n;
    if (future === 0) return;
    purgeDeviceCloudData(db, FICTIONAL_DEMO_DEVICE_ID);
  }

  const worker = db.prepare('SELECT * FROM workers WHERE email = ?').get('demo.worker@unfold.local');
  if (!worker?.verified) throw new Error('The local demo worker must be verified before seeding the fictional case.');

  const realNow = new Date();
  const now = new Date(realNow.getTime() - timelineShiftDays(realNow) * DAY_MS);
  const history = buildHistory(now);
  const createdAt = atOffset(now, FIXTURE.case.createdDaysAgo, FIXTURE.case.createdTime);
  const claimedAt = atOffset(now, FIXTURE.case.claimedDaysAgo, FIXTURE.case.claimedTime);
  const continuedAt = atOffset(now, FIXTURE.case.continuedDaysAgo, FIXTURE.case.continuedTime);
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
