// node --test electron/main   (npm run test:electron)
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { createPresentationService } = require('./presentation-service');
const { pathExists } = require('./fs-utils');
const { createId, sanitizeName } = require('./value-utils');

// PowerPoint is faked: "thumb" writes a tiny picture and reports 12 slides; "new" writes a file.
function setup({ thumbFails = false, thumbError = 'boom' } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'noprep-pres-'));
  const calls = [];
  const powerPoint = {
    send: async (cmd, args) => {
      calls.push(cmd);
      if (cmd === 'thumb') {
        if (typeof thumbFails === 'function' ? thumbFails() : thumbFails) return { ok: false, error: thumbError };
        await fsp.writeFile(args.out, 'png');
        return { ok: true, slides: 12 };
      }
      if (cmd === 'new') {
        await fsp.writeFile(args.path, 'pptx');
        return { ok: true };
      }
      return { ok: true };
    }
  };
  const app = { getPath: () => userData };
  const service = createPresentationService({ app, fsp, path, pathExists, createId, sanitizeName, powerPoint });
  const source = (name) => {
    const file = path.join(userData, name);
    fs.writeFileSync(file, 'slides');
    return file;
  };
  return { service, calls, source, userData };
}

test('adds copies of .pptx and .ppt files, with a picture and the slide count', async () => {
  const { service, source } = setup();
  const result = await service.importFiles([source('Unit 1 Lesson 1.pptx'), source('Old.ppt'), source('notes.docx')]);
  assert.equal(result.added.length, 2);
  assert.deepEqual(result.failed, ['notes.docx']);
  const list = await service.list();
  assert.deepEqual(list.map((item) => item.title).sort(), ['Old', 'Unit 1 Lesson 1']);
  assert.ok(list.every((item) => item.slideCount === 12 && item.thumbVersion === 1));
  assert.match(await service.thumbnailDataUrl(list[0].id), /^data:image\/png;base64,/);
});

test('keeps a file PowerPoint could not preview (no picture yet)', async () => {
  const { service, source } = setup({ thumbFails: true });
  const result = await service.importFiles([source('Lesson.pptx')]);
  assert.equal(result.added.length, 1);
  assert.equal(await service.thumbnailDataUrl(result.added[0].id), null);
});

test('PowerPoint busy with a question box: the card is added, reported busy, and filled in later', async () => {
  let busy = true;
  const { service, source } = setup({ thumbFails: () => busy, thumbError: 'POWERPOINT_BUSY' });
  const result = await service.importFiles([source('Culture 1.pptx')]);
  assert.equal(result.busy, true);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].error, undefined);
  const [item] = await service.list();
  assert.equal(service.needsPicture(item), true);
  busy = false;                                   // the teacher answered PowerPoint's question
  const repaired = await service.refreshThumbnail(item.id);
  assert.equal(repaired.slideCount, 12);
  assert.equal(repaired.error, undefined);
  assert.equal(service.needsPicture(repaired), false);
});

test('renames, and deletes the copy (never the original)', async () => {
  const { service, source } = setup();
  const original = source('Lesson.pptx');
  const [item] = (await service.importFiles([original])).added;
  await service.rename(item.id, '  Animals  ');
  assert.equal((await service.get(item.id)).title, 'Animals');
  await service.rename(item.id, '   ');
  assert.equal((await service.get(item.id)).title, 'Animals');
  const copy = await service.filePath(item.id);
  await service.remove(item.id);
  assert.equal(await pathExists(copy), false);
  assert.equal(await pathExists(original), true);
  assert.deepEqual(await service.list(), []);
});

test('a new blank presentation is made by PowerPoint and listed', async () => {
  const { service, calls } = setup();
  const created = await service.createBlank('My lesson');
  assert.equal(created.ok, true);
  assert.equal(created.item.fileName, 'My lesson.pptx');
  assert.deepEqual(calls, ['new']);
  assert.equal((await service.list()).length, 1);
});

test('slide pictures for "jump to a slide" are dropped once the presentation is edited', async () => {
  const { service, source } = setup();
  const [item] = (await service.importFiles([source('Lesson.pptx')])).added;
  const dir = service.slidesDir(item.id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, '1.png'), 'png');
  await service.refreshThumbnail(item.id);
  assert.equal(await pathExists(dir), false);
  assert.equal((await service.get(item.id)).thumbVersion, 2);
});

test('drops a presentation whose file has gone missing from the list', async () => {
  const { service, source } = setup();
  const [item] = (await service.importFiles([source('Lesson.pptx')])).added;
  await fsp.rm(await service.filePath(item.id));
  assert.deepEqual(await service.list(), []);
});

test('a book carries its PowerPoint files: export from one library, import into another', async () => {
  const { presentationIdsInBook } = require('./presentation-service');
  const teacherA = setup();
  const [lesson] = (await teacherA.service.importFiles([teacherA.source('Unit 1 Lesson 1.pptx')])).added;
  const book = {
    pages: [{ id: 'p1', elements: [{ type: 'presentation', data: { presentationId: lesson.id, presentationTitle: lesson.title } }] }],
    workbooks: [{ pages: [{ elements: [
      { type: 'presentation', data: { presentationKind: 'link', presentationId: 'link-1' } },
      { type: 'presentation', data: { presentationId: 'pres-not-here' } }
    ] }] }]
  };
  assert.deepEqual(presentationIdsInBook(book).sort(), [lesson.id, 'pres-not-here'].sort());

  // Export: only the presentation that is really in the library is copied.
  const exported = fs.mkdtempSync(path.join(os.tmpdir(), 'noprep-book-'));
  const entries = await teacherA.service.bundleEntries(presentationIdsInBook(book));
  assert.equal(entries.length, 1);
  await teacherA.service.writeBundle(entries, path.join(exported, 'presentations'));
  assert.ok(fs.existsSync(path.join(exported, 'presentations', lesson.id, lesson.fileName)));

  // Import on another computer: same id, same file, and the folder leaves the book.
  const teacherB = setup();
  assert.equal(await teacherB.service.adoptBundle(exported), 1);
  const [adopted] = await teacherB.service.list();
  assert.equal(adopted.id, lesson.id);
  assert.equal(adopted.title, 'Unit 1 Lesson 1');
  assert.equal(adopted.slideCount, 12);
  assert.equal(fs.readFileSync(await teacherB.service.filePath(lesson.id), 'utf8'), 'slides');
  assert.ok(!fs.existsSync(path.join(exported, 'presentations')));

  // Importing the same book again keeps the one already there.
  await teacherA.service.writeBundle(entries, path.join(exported, 'presentations'));
  assert.equal(await teacherB.service.adoptBundle(exported), 0);
  assert.equal((await teacherB.service.list()).length, 1);
});

test('a book package can never place files outside the library', async () => {
  const { service } = setup();
  const book = fs.mkdtempSync(path.join(os.tmpdir(), 'noprep-book-'));
  const bundle = path.join(book, 'presentations');
  fs.mkdirSync(path.join(bundle, 'pres-ok'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'pres-ok', 'a.pptx'), 'slides');
  fs.writeFileSync(path.join(bundle, 'presentations.json'), JSON.stringify([
    { id: '../../evil', fileName: 'a.pptx', title: 'x' },
    { id: 'pres-ok', fileName: '../a.pptx', title: 'x' },
    { id: 'pres-ok', fileName: 'run.exe', title: 'x' },
    { id: 'pres-ok', fileName: 'a.pptx', title: 'Fine' }
  ]));
  assert.equal(await service.adoptBundle(book), 1);
  assert.deepEqual((await service.list()).map((item) => item.title), ['Fine']);
});
