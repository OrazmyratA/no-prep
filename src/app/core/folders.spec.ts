import { db } from './db.model';
import { ensureFolderPath, folderPathOf, FolderService } from './folders';

describe('library folders', () => {
  let folders: FolderService;

  beforeEach(async () => {
    await db.folders.clear();
    await db.folderPlacements.clear();
    await db.topics.clear();
    folders = new FolderService();
    await folders.load(true);
    folders.open(null);
  });

  it('makes nested folders and shows the way down to them', async () => {
    const grade = await folders.create('Grade 3', null, '#2563eb', '🏫');
    const unit = await folders.create('Unit 1', grade.id);
    expect(folders.children(null).map((f) => f.name)).toEqual(['Grade 3']);
    expect(folders.children(grade.id).map((f) => f.name)).toEqual(['Unit 1']);
    expect(folders.pathLabel(unit.id)).toBe('Grade 3 › Unit 1');
  });

  it('deleting a folder moves everything inside up one level and deletes nothing', async () => {
    const grade = await folders.create('Grade 3', null);
    const unit = await folders.create('Unit 1', grade.id);
    const week = await folders.create('Week 1', unit.id);
    const topicId = await db.topics.add({ name: 'Animals', createdAt: new Date(), updatedAt: new Date(), folderId: unit.id });
    await folders.move('book', ['book-1'], unit.id);

    await folders.remove(unit.id);

    expect(folders.byId(unit.id)).toBeNull();
    expect(folders.byId(week.id)?.parentId).toBe(grade.id);
    expect((await db.topics.get(topicId))?.folderId).toBe(grade.id);
    expect(folders.placementOf('book', 'book-1')).toBe(grade.id);
  });

  it('deleting a top folder puts its things at the top', async () => {
    const grade = await folders.create('Grade 3', null);
    await folders.move('ppt', ['pres-1'], grade.id);
    await folders.remove(grade.id);
    expect(folders.placementOf('ppt', 'pres-1')).toBeNull();
    expect(await db.folderPlacements.count()).toBe(0);
  });

  it('knows where things are now and leaves the ones already there alone', async () => {
    const grade = await folders.create('Grade 3', null);
    const unit = await folders.create('Unit 1', grade.id);
    const old = new Date('2026-01-01');
    const inUnit = await db.topics.add({ name: 'Animals', createdAt: old, updatedAt: old, folderId: unit.id, folderMovedAt: old });
    const atTop = await db.topics.add({ name: 'Food', createdAt: old, updatedAt: old });
    await folders.move('book', ['book-1'], grade.id);

    expect(await folders.foldersOf('topic', [inUnit, atTop])).toEqual([unit.id, null]);
    expect(await folders.foldersOf('book', ['book-1', 'book-2'])).toEqual([grade.id, null]);
    expect(await folders.foldersOf('folder', [unit.id, grade.id])).toEqual([grade.id, null]);

    await folders.move('topic', [inUnit, atTop], unit.id);
    expect((await db.topics.get(inUnit))?.folderMovedAt).toEqual(old);
    expect((await db.topics.get(atTop))?.folderId).toBe(unit.id);
  });

  it('never moves a folder into itself or a folder inside it', async () => {
    const grade = await folders.create('Grade 3', null);
    const unit = await folders.create('Unit 1', grade.id);
    const other = await folders.create('Grade 4', null);
    const targets = folders.targetsFor('folder', [grade.id]);
    expect(targets.has(grade.id)).toBe(false);
    expect(targets.has(unit.id)).toBe(false);
    expect(targets.has(other.id)).toBe(true);

    await folders.move('folder', [grade.id], unit.id);
    expect(folders.byId(grade.id)?.parentId).toBe('');
  });

  it('a topic export carries its folder path, and an import finds or makes the folders again', async () => {
    const grade = await folders.create('Grade 3', null, '#16a34a', '🐾');
    const unit = await folders.create('Unit 1', grade.id);
    const path = await folderPathOf(unit.id);
    expect(path).toEqual([{ name: 'Grade 3', color: '#16a34a', emoji: '🐾' }, { name: 'Unit 1' }]);

    // Same names: the same folder, nothing new.
    expect(await ensureFolderPath(path)).toBe(unit.id);
    expect(await db.folders.count()).toBe(2);

    // On another computer (no folders yet): made again, colour and emoji kept.
    await db.folders.clear();
    const made = await ensureFolderPath(path);
    await folders.load(true);
    expect(folders.pathLabel(made)).toBe('Grade 3 › Unit 1');
    expect(folders.children(null)[0].emoji).toBe('🐾');
  });

  it('a new book or presentation goes into the folder being looked at', async () => {
    const grade = await folders.create('Grade 3', null);
    folders.open(grade.id);
    await folders.placeNew('book', ['book-9']);
    expect(folders.placementOf('book', 'book-9')).toBe(grade.id);
    folders.open(null);
    await folders.placeNew('ppt', ['pres-9']);
    expect(folders.placementOf('ppt', 'pres-9')).toBeNull();
  });
});
