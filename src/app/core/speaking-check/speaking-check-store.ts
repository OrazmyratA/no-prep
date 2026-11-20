import { Injectable, NgZone } from '@angular/core';
import { db } from '../db.model';
import { SpeakingSession } from './speaking-check-session';

/** Speaking Check sessions on this device, newest first per class. */
@Injectable({ providedIn: 'root' })
export class SpeakingCheckStore {
  constructor(private zone: NgZone) {}

  async listForClass(classTopicId: number): Promise<SpeakingSession[]> {
    const sessions = await db.speakingSessions.where('classTopicId').equals(classTopicId).toArray();
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return this.inZone(sessions);
  }

  async get(id: string): Promise<SpeakingSession | null> {
    return this.inZone((await db.speakingSessions.get(id)) ?? null);
  }

  /** Saves a copy (the screen keeps editing its own object). */
  async save(session: SpeakingSession): Promise<SpeakingSession> {
    const copy: SpeakingSession = JSON.parse(JSON.stringify({ ...session, updatedAt: new Date().toISOString() }));
    await db.speakingSessions.put(copy);
    return this.inZone(copy);
  }

  async remove(id: string): Promise<void> {
    await db.speakingSessions.delete(id);
  }

  // The database's promises can finish outside Angular's zone; hand results back inside it so
  // the screen redraws straight away.
  private inZone<T>(value: T): Promise<T> {
    return new Promise((resolve) => this.zone.run(() => resolve(value)));
  }
}
