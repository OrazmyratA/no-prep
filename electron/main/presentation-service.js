// The teacher's PowerPoint presentations: each lives in its own folder under
// userData/Presentations (the .ppt/.pptx file and a picture of its first slide), listed in
// presentations.json. Playing and editing go through PowerPoint (powerpoint-service.js).
const PRESENTATION_EXTENSIONS = ['.pptx', '.ppt', '.ppsx', '.pps', '.pptm'];
const THUMB_FILE = 'thumb.png';
const THUMB_WIDTH = 640;
/** In an exported book: the folder with copies of its PowerPoint files, and their list. */
const BUNDLE_DIR = 'presentations';
const BUNDLE_MANIFEST = 'presentations.json';

function createPresentationService({ app, fsp, path, pathExists, createId, sanitizeName, powerPoint }) {
  const root = () => path.join(app.getPath('userData'), 'Presentations');
  const registryPath = () => path.join(root(), 'presentations.json');

  async function readRegistry() {
    try {
      const parsed = JSON.parse(await fsp.readFile(registryPath(), 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeRegistry(items) {
    await fsp.mkdir(root(), { recursive: true });
    const target = registryPath();
    const temp = `${target}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(items, null, 2), 'utf8');
    await fsp.rename(temp, target);
  }

  async function update(id, change) {
    const items = await readRegistry();
    const item = items.find((entry) => entry.id === id);
    if (!item) return null;
    Object.assign(item, change);
    await writeRegistry(items);
    return item;
  }

  const folderOf = (id) => path.join(root(), String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
  const filePathOf = (item) => path.join(folderOf(item.id), item.fileName);
  const thumbPathOf = (id) => path.join(folderOf(id), THUMB_FILE);
  /** Small pictures of every slide ("jump to a slide"); made while playing, dropped after an edit. */
  const slidesDirOf = (id) => path.join(folderOf(id), 'slides');

  async function get(id) {
    return (await readRegistry()).find((entry) => entry.id === id) ?? null;
  }

  async function list() {
    const items = await readRegistry();
    const present = [];
    for (const item of items) {
      if (await pathExists(filePathOf(item))) present.push(item);
    }
    return present;
  }

  /**
   * Makes the first-slide picture and counts the slides (PowerPoint does both). When PowerPoint
   * could not do it (e.g. busy with a question box), the result carries its `error`; the card
   * keeps slideCount 0 and is tried again later (needsPicture).
   */
  async function refreshThumbnail(id) {
    const item = await get(id);
    if (!item) return null;
    const result = await powerPoint.send('thumb', { path: filePathOf(item), out: thumbPathOf(id), width: THUMB_WIDTH });
    await fsp.rm(slidesDirOf(id), { recursive: true, force: true });
    const change = { updatedAt: new Date().toISOString(), thumbVersion: (item.thumbVersion ?? 0) + 1 };
    if (result.ok) change.slideCount = result.slides;
    const updated = await update(id, change);
    return updated && !result.ok ? { ...updated, error: result.error || 'PRESENTATION_FAILED' } : updated;
  }

  /** Cards PowerPoint has not read yet (no picture, no slide count). */
  const needsPicture = (item) => !item.slideCount;

  async function importFiles(filePaths) {
    const added = [];
    const failed = [];
    let busy = false;
    for (const source of filePaths) {
      const ext = path.extname(source).toLowerCase();
      if (!PRESENTATION_EXTENSIONS.includes(ext)) {
        failed.push(path.basename(source));
        continue;
      }
      const id = createId('pres');
      const title = path.basename(source, path.extname(source));
      const fileName = `${sanitizeName(title, 'presentation')}${ext}`;
      try {
        await fsp.mkdir(folderOf(id), { recursive: true });
        await fsp.copyFile(source, path.join(folderOf(id), fileName));
        const now = new Date().toISOString();
        const items = await readRegistry();
        items.unshift({ id, title, fileName, slideCount: 0, createdAt: now, updatedAt: now, thumbVersion: 0 });
        await writeRegistry(items);
        const item = await refreshThumbnail(id);
        if (item?.error === 'POWERPOINT_BUSY') busy = true;
        if (item) delete item.error;
        added.push(item);
      } catch (error) {
        console.error('Could not add presentation', source, error);
        await fsp.rm(folderOf(id), { recursive: true, force: true }).catch(() => undefined);
        failed.push(path.basename(source));
      }
    }
    return { added: added.filter(Boolean), failed, busy };
  }

  /** A new, empty presentation, opened in PowerPoint for the teacher to make. */
  async function createBlank(title) {
    const id = createId('pres');
    const cleanTitle = String(title || '').trim() || 'New presentation';
    const fileName = `${sanitizeName(cleanTitle, 'presentation')}.pptx`;
    await fsp.mkdir(folderOf(id), { recursive: true });
    const now = new Date().toISOString();
    const item = { id, title: cleanTitle, fileName, slideCount: 1, createdAt: now, updatedAt: now, thumbVersion: 0 };
    const result = await powerPoint.send('new', { path: path.join(folderOf(id), fileName) });
    if (!result.ok) {
      await fsp.rm(folderOf(id), { recursive: true, force: true }).catch(() => undefined);
      return { ok: false, error: result.error };
    }
    const items = await readRegistry();
    items.unshift(item);
    await writeRegistry(items);
    return { ok: true, item };
  }

  async function rename(id, title) {
    const clean = String(title || '').trim();
    if (!clean) return null;
    return update(id, { title: clean, updatedAt: new Date().toISOString() });
  }

  async function remove(id) {
    const items = await readRegistry();
    await writeRegistry(items.filter((entry) => entry.id !== id));
    await fsp.rm(folderOf(id), { recursive: true, force: true }).catch(() => undefined);
    return true;
  }

  async function thumbnailDataUrl(id) {
    try {
      const bytes = await fsp.readFile(thumbPathOf(id));
      return `data:image/png;base64,${bytes.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async function filePath(id) {
    const item = await get(id);
    return item ? filePathOf(item) : null;
  }

  // ---------- Copies that travel with an exported book ----------
  // An exported book carries the PowerPoint files its PPT icons link to, in a "presentations"
  // folder: <id>/<file>, <id>/thumb.png and presentations.json (id, title, fileName, slideCount).
  // Importing the book adds them to this computer's library under the same ids, so the icons work.

  /** The presentations of this library a book links to, with their files (missing ones left out). */
  async function bundleEntries(ids) {
    const items = await readRegistry();
    const entries = [];
    for (const id of new Set(ids)) {
      const item = items.find((entry) => entry.id === id);
      if (!item) continue;
      const file = filePathOf(item);
      if (!(await pathExists(file))) continue;
      const thumb = thumbPathOf(id);
      const size = (await fsp.stat(file)).size;
      entries.push({
        item: { id: item.id, title: item.title, fileName: item.fileName, slideCount: item.slideCount || 0 },
        file,
        thumb: (await pathExists(thumb)) ? thumb : null,
        size
      });
    }
    return entries;
  }

  /** Writes the entries into a book export's "presentations" folder. */
  async function writeBundle(entries, bundleDir) {
    if (!entries.length) return;
    for (const entry of entries) {
      const dir = path.join(bundleDir, entry.item.id);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.copyFile(entry.file, path.join(dir, entry.item.fileName));
      if (entry.thumb) await fsp.copyFile(entry.thumb, path.join(dir, THUMB_FILE));
    }
    await fsp.writeFile(path.join(bundleDir, BUNDLE_MANIFEST), JSON.stringify(entries.map((entry) => entry.item), null, 2), 'utf8');
  }

  /** The zip entries (archive names) for the same folder, for a .noprepbook package. */
  function bundleZipEntries(entries) {
    const files = [];
    for (const entry of entries) {
      files.push({ path: entry.file, name: `${BUNDLE_DIR}/${entry.item.id}/${entry.item.fileName}` });
      if (entry.thumb) files.push({ path: entry.thumb, name: `${BUNDLE_DIR}/${entry.item.id}/${THUMB_FILE}` });
    }
    const texts = entries.length
      ? [{ name: `${BUNDLE_DIR}/${BUNDLE_MANIFEST}`, content: JSON.stringify(entries.map((entry) => entry.item), null, 2) }]
      : [];
    return { files, texts };
  }

  /**
   * An imported book's "presentations" folder: moves each presentation into this library (same id;
   * one already here is kept as it is) and removes the folder from the book. Returns how many were added.
   */
  async function adoptBundle(bookFolder) {
    const bundleDir = path.join(bookFolder, BUNDLE_DIR);
    if (!(await pathExists(bundleDir))) return 0;
    let added = 0;
    try {
      let manifest = [];
      try {
        manifest = JSON.parse(await fsp.readFile(path.join(bundleDir, BUNDLE_MANIFEST), 'utf8'));
      } catch {
        manifest = [];
      }
      const items = await readRegistry();
      for (const entry of Array.isArray(manifest) ? manifest : []) {
        const id = String(entry?.id || '');
        const fileName = String(entry?.fileName || '');
        // Only plain names: nothing in a package may point outside its own folder.
        if (!/^pres-[A-Za-z0-9_-]+$/.test(id) || !fileName || path.basename(fileName) !== fileName) continue;
        if (!PRESENTATION_EXTENSIONS.includes(path.extname(fileName).toLowerCase())) continue;
        const source = path.join(bundleDir, id, fileName);
        if (!(await pathExists(source))) continue;
        const existing = items.find((item) => item.id === id);
        if (existing && (await pathExists(filePathOf(existing)))) continue;
        await fsp.mkdir(folderOf(id), { recursive: true });
        await moveFile(source, path.join(folderOf(id), fileName));
        const thumb = path.join(bundleDir, id, THUMB_FILE);
        const hasThumb = await pathExists(thumb);
        if (hasThumb) await moveFile(thumb, thumbPathOf(id));
        const now = new Date().toISOString();
        const item = {
          id,
          title: String(entry.title || path.basename(fileName, path.extname(fileName))),
          fileName,
          slideCount: hasThumb ? Math.max(0, Number(entry.slideCount) || 0) : 0,
          createdAt: now,
          updatedAt: now,
          thumbVersion: 1
        };
        const at = items.findIndex((other) => other.id === id);
        if (at >= 0) items[at] = item;
        else items.unshift(item);
        added++;
      }
      if (added) await writeRegistry(items);
    } finally {
      await fsp.rm(bundleDir, { recursive: true, force: true }).catch(() => undefined);
    }
    return added;
  }

  async function moveFile(from, to) {
    try {
      await fsp.rename(from, to);
    } catch {
      await fsp.copyFile(from, to);   // another drive
      await fsp.rm(from, { force: true }).catch(() => undefined);
    }
  }

  return {
    PRESENTATION_EXTENSIONS,
    BUNDLE_DIR,
    bundleEntries,
    writeBundle,
    bundleZipEntries,
    adoptBundle,
    root,
    slidesDir: (id) => slidesDirOf(id),
    list,
    get,
    importFiles,
    createBlank,
    rename,
    remove,
    refreshThumbnail,
    needsPicture,
    thumbnailDataUrl,
    filePath
  };
}

module.exports = { createPresentationService };

/** The PowerPoint presentations a book's PPT icons link to (ids), in every page of every part. */
function presentationIdsInBook(book) {
  const ids = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'presentation' && value.data && value.data.presentationKind !== 'link' && value.data.presentationId) {
      ids.add(String(value.data.presentationId));
    }
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') visit(nested);
    }
  };
  visit(book);
  return [...ids];
}

module.exports.presentationIdsInBook = presentationIdsInBook;
