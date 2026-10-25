import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { db, Topic, Item, LeaderboardScore, CefrLevel, SpeakingExam } from './db.model';

@Injectable({ providedIn: 'root' })
export class DbService {
  private topicsSubject = new BehaviorSubject<Topic[]>([]);
  topics$: Observable<Topic[]> = this.topicsSubject.asObservable();
  /** False until the topics were read once: topics$ starts as [] before that, which is not "none". */
  topicsLoaded = false;

  // Topic id → object URL of its cover: the first item, in play order, that has a picture.
  // Kept for the whole session, so coming back to the topics list costs nothing. '' = no picture.
  private coverUrls = new Map<number, string>();
  private coverUrlsSubject = new BehaviorSubject<ReadonlyMap<number, string>>(this.coverUrls);
  topicCoverUrls$: Observable<ReadonlyMap<number, string>> = this.coverUrlsSubject.asObservable();
  private coverRun = 0;

  constructor(private zone: NgZone) {
    this.refreshTopics();
  }

  private async refreshTopics() {
    const topics = await db.topics.orderBy('updatedAt').reverse().toArray();
    // Outside the zone: each of the per-topic reads settling in it would run change detection
    // over the whole app (~120 passes on a big library) before the cards can even be built.
    const itemIds = await this.zone.runOutsideAngular(() => this.itemIdsByTopic(topics.map(t => t.id!)));
    const topicsWithCount = topics.map(t => ({ ...t, itemCount: itemIds.get(t.id!)?.length || 0 }));
    this.zone.run(() => {
      this.topicsLoaded = true;
      this.topicsSubject.next(topicsWithCount);
    });
    void this.refreshCovers(topicsWithCount, itemIds);
  }

  /**
   * Item ids per topic in play order (`order`, then id — the same as sortBy('order')), read from
   * the indexes alone. Reading the item records instead would open every picture and voice clip.
   * One bulk key read per topic (in parallel) is ~5× faster than a cursor stepping through every
   * item key, which held up the first topic cards on a slow PC.
   */
  private async itemIdsByTopic(topicIds: number[]): Promise<Map<number, number[]>> {
    const [perTopic, inPlayOrder] = await Promise.all([
      Promise.all(topicIds.map(id => db.items.where('topicId').equals(id).primaryKeys())),
      db.items.orderBy('order').primaryKeys()
    ]);
    const rank = new Map<number, number>();
    inPlayOrder.forEach((id, index) => rank.set(id as number, index));
    // Items without an `order` are not in that index; they go last, by id.
    const byPlayOrder = (a: number, b: number) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a - b;
    return new Map(topicIds.map((id, i) => [id, (perTopic[i] as number[]).sort(byPlayOrder)]));
  }

  private async refreshCovers(topics: Topic[], itemIds: Map<number, number[]>): Promise<void> {
    const run = ++this.coverRun;
    const pending = new Map<number, number[]>();
    for (const topic of topics) {
      if (topic.id != null && !this.coverUrls.has(topic.id)) pending.set(topic.id, itemIds.get(topic.id) ?? []);
    }

    // Look at each topic's first item, then the second for those without a picture, and so on —
    // usually a single read of one item per topic.
    const found = new Map<number, Blob | null>();
    for (let index = 0; pending.size; index++) {
      const asked = [...pending].filter(([topicId, ids]) => {
        if (index < ids.length) return true;
        found.set(topicId, null);
        pending.delete(topicId);
        return false;
      });
      if (!asked.length) break;
      const items = await db.items.bulkGet(asked.map(([, ids]) => ids[index]));
      if (run !== this.coverRun) return;
      asked.forEach(([topicId], i) => {
        const image = items[i]?.image;
        if (!image) return;
        found.set(topicId, image);
        pending.delete(topicId);
      });
    }

    const liveIds = new Set(topics.map(topic => topic.id));
    for (const topicId of [...this.coverUrls.keys()]) {
      if (!liveIds.has(topicId)) this.dropCover(topicId);
    }
    for (const [topicId, image] of found) {
      this.coverUrls.set(topicId, image ? URL.createObjectURL(image) : '');
    }
    this.coverUrlsSubject.next(new Map(this.coverUrls));
  }

  // Also cancels a cover lookup still running, which may have read the topic's items before a change.
  private dropCover(topicId: number): void {
    this.coverRun++;
    const url = this.coverUrls.get(topicId);
    if (url) URL.revokeObjectURL(url);
    this.coverUrls.delete(topicId);
  }

  // Public method to refresh from outside (e.g., after import)
  async refresh() {
    for (const topicId of [...this.coverUrls.keys()]) this.dropCover(topicId);
    await this.refreshTopics();
  }

  async createTopic(name: string, level?: CefrLevel, exam?: SpeakingExam): Promise<number> {
    const now = new Date();
    const id = await db.topics.add({ name, createdAt: now, updatedAt: now, ...(level ? { level } : {}), ...(exam ? { exam } : {}) });
    await this.refreshTopics();
    return id;
  }

  /** `level` / `exam`: undefined = keep it, null = remove it. */
  async updateTopic(id: number, name: string, level?: CefrLevel | null, exam?: SpeakingExam | null): Promise<void> {
    const changes: Partial<Topic> = { name, updatedAt: new Date() };
    // Dexie deletes a property whose new value is undefined.
    if (level !== undefined) changes.level = level ?? undefined;
    if (exam !== undefined) changes.exam = exam ?? undefined;
    await db.topics.update(id, changes);
    await this.refreshTopics();
  }

  async deleteTopic(id: number): Promise<void> {
    await db.items.where('topicId').equals(id).delete();
    await db.speakingResults.where('topicId').equals(id).delete();
    await db.topics.delete(id);
    this.dropCover(id);
    await this.refreshTopics();
  }

async addItems(topicId: number, items: Omit<Item, 'id' | 'topicId' | 'createdAt' | 'order'>[]): Promise<void> {
  const now = new Date();
  const itemsToAdd = items.map((item, index) => ({
    topicId,
    text: item.text,
    image: item.image,
    audio: item.audio,
    audioSource: item.audioSource,
    audioPitch: item.audioPitch,
    audioSpeed: item.audioSpeed,
    audioText: item.audioText,
    imageText: item.imageText,
    order: index,
    createdAt: now
  }));
  await db.items.bulkAdd(itemsToAdd);
  this.dropCover(topicId);
  await this.refreshTopics();
}

  // Updates in place (by id) rather than delete-and-recreate, so items the teacher didn't touch
  // keep their id — and therefore keep their leaderboardScores row linked (adjustLeaderboardScore
  // keys scores by itemId, so regenerating ids here would silently zero out everyone's points).
  // Items without an id (newly added in the form) get inserted; items no longer present get
  // deleted along with their now-orphaned score row.
  async updateItems(topicId: number, items: (Omit<Item, 'id' | 'topicId' | 'createdAt' | 'order'> & { id?: number })[]): Promise<void> {
    const existing = await db.items.where('topicId').equals(topicId).toArray();
    const existingIds = new Set(existing.map(i => i.id));
    const incomingIds = new Set(items.filter(i => i.id != null).map(i => i.id));
    const now = new Date();

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const voice = {
        audioSource: item.audioSource,
        audioPitch: item.audioPitch,
        audioSpeed: item.audioSpeed,
        audioText: item.audioText,
        imageText: item.imageText
      };
      if (item.id != null && existingIds.has(item.id)) {
        await db.items.update(item.id, { text: item.text, image: item.image, audio: item.audio, ...voice, order: index });
      } else {
        await db.items.add({ topicId, text: item.text, image: item.image, audio: item.audio, ...voice, order: index, createdAt: now });
      }
    }

    const removedIds = existing.map(i => i.id!).filter(id => !incomingIds.has(id));
    if (removedIds.length) {
      await db.items.bulkDelete(removedIds);
      await db.leaderboardScores.where('itemId').anyOf(removedIds).delete();
    }

    this.dropCover(topicId);
    await this.refreshTopics();
  }

async duplicateTopic(topicId: number): Promise<number | null> {
  const topic = await db.topics.get(topicId);
  if (!topic) return null;
  const items = await db.items.where('topicId').equals(topicId).sortBy('order');
  const copyName = `${topic.name} (Copy)`;
  const newTopicId = await this.createTopic(copyName, topic.level, topic.exam);
  await this.addItems(newTopicId, items.map(item => ({
    text: item.text,
    image: item.image ?? undefined,
    audio: item.audio ?? undefined,
    audioSource: item.audioSource,
    audioPitch: item.audioPitch,
    audioSpeed: item.audioSpeed,
    audioText: item.audioText,
    imageText: item.imageText
  })));
  await this.refreshTopics();
  return newTopicId;
}

  async getTopicById(topicId: number): Promise<Topic | undefined> {
    return await db.topics.get(topicId);
  }

  async getItemsSnapshot(topicId: number): Promise<Item[]> {
    return await db.items.where('topicId').equals(topicId).sortBy('order');
  }

  // Leaderboard scores are read once per topic load and mutated locally by the caller,
  // so unlike the methods above they don't touch topics$/refreshTopics().

  async getLeaderboardScores(topicId: number): Promise<LeaderboardScore[]> {
    return await db.leaderboardScores.where('topicId').equals(topicId).toArray();
  }

  async adjustLeaderboardScore(topicId: number, itemId: number, delta: number): Promise<number> {
    // Plain sequential awaits (no db.transaction wrapper) — Dexie's transaction-zone tracking
    // breaks under Angular's zone.js when the transaction scope uses native async/await,
    // causing a "PrematureCommitError". No other method in this file uses transactions either.
    const existing = await db.leaderboardScores.where('[topicId+itemId]').equals([topicId, itemId]).first();
    const now = new Date();
    if (existing) {
      const points = existing.points + delta;
      await db.leaderboardScores.update(existing.id!, { points, updatedAt: now });
      return points;
    }
    await db.leaderboardScores.add({ topicId, itemId, points: delta, updatedAt: now });
    return delta;
  }

  async resetLeaderboardScores(topicId: number): Promise<void> {
    await db.leaderboardScores.where('topicId').equals(topicId).delete();
  }

  // "Today's session": stashes each row's current total as baselinePoints, then zeroes points so
  // the teacher sees just what's collected from here on. adjustLeaderboardScore only ever writes
  // points/updatedAt, so it leaves baselinePoints untouched while a session is running. A student
  // with no row yet (never scored) has nothing to stash — their first point during the session
  // creates a row with no baselinePoints at all, which is already their correct total.
  async startScoreSession(topicId: number): Promise<void> {
    const rows = await db.leaderboardScores.where('topicId').equals(topicId).toArray();
    const now = new Date();
    for (const row of rows) {
      await db.leaderboardScores.update(row.id!, { baselinePoints: row.points, points: 0, updatedAt: now });
    }
  }

  // Adds each row's session-collected points back onto its stashed baseline and clears the
  // stash. Rows with no baselinePoints (never had a session, or were created after the session
  // started) are left as-is — their current points are already the correct total.
  async endScoreSession(topicId: number): Promise<void> {
    const rows = await db.leaderboardScores.where('topicId').equals(topicId).toArray();
    const now = new Date();
    for (const row of rows) {
      if (row.baselinePoints == null) continue;
      await db.leaderboardScores.update(row.id!, { points: row.points + row.baselinePoints, baselinePoints: null, updatedAt: now });
    }
  }
}