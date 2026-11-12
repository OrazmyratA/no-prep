// IPC for the Presentations library and its player. The player's stage is a box in the page; the
// slideshow (PowerPoint's own window) is kept exactly over it, following the No-Prep window as it
// moves, resizes or goes full screen.
const EDIT_POLL_MS = 2500;

function registerPresentationIpc({ ipcMain, dialog, fsp, path, app, getMainWindow, presentations, powerPoint, operationResult, operationError }) {
  let stageRect = null;          // { x, y, width, height } in page (CSS) pixels
  let playing = false;
  let playingId = '';
  let followedWindow = null;
  const editing = new Set();
  let editTimer = null;

  const notifyChanged = () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('presentations:changed');
  };

  // The helper isn't DPI-aware, so Windows gives it the same scaled pixels Electron uses (DIPs).
  function screenRect() {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || !stageRect) return null;
    const content = win.getContentBounds();
    const zoom = win.webContents.getZoomFactor() || 1;
    return {
      x: Math.round(content.x + stageRect.x * zoom),
      y: Math.round(content.y + stageRect.y * zoom),
      w: Math.max(1, Math.round(stageRect.width * zoom)),
      h: Math.max(1, Math.round(stageRect.height * zoom))
    };
  }

  const follow = () => {
    if (!playing) return;
    const rect = screenRect();
    if (rect) void powerPoint.send('move', rect);
  };

  function followWindow(win) {
    if (followedWindow === win) return;
    followedWindow = win;
    for (const event of ['move', 'resize', 'enter-full-screen', 'leave-full-screen', 'restore', 'maximize', 'unmaximize']) {
      win.on(event, follow);
    }
  }

  async function stop() {
    if (!playing) return;
    playing = false;
    stageRect = null;
    await powerPoint.send('stop');
  }

  // Watches presentations open for editing: once the teacher closes one in PowerPoint, its card
  // picture and slide count are refreshed.
  function watchEditing() {
    if (editTimer) return;
    editTimer = setInterval(async () => {
      for (const id of [...editing]) {
        const filePath = await presentations.filePath(id);
        const result = filePath ? await powerPoint.send('isopen', { path: filePath }) : { ok: true, open: false };
        if (result.ok && !result.open) {
          editing.delete(id);
          await presentations.refreshThumbnail(id);
          notifyChanged();
        }
      }
      if (!editing.size) {
        clearInterval(editTimer);
        editTimer = null;
      }
    }, EDIT_POLL_MS);
  }

  const guard = (handler) => async (_event, input = {}) => {
    try {
      return await handler(input ?? {});
    } catch (error) {
      console.error('Presentation action failed', error);
      return operationError('PRESENTATION_FAILED', error?.message || String(error));
    }
  };

  let cleanedUp = false;
  ipcMain.handle('presentations:status', guard(async () => {
    const available = await powerPoint.isAvailable();
    // Once a session: close a slideshow a crashed No-Prep left open in PowerPoint.
    if (available && !cleanedUp) {
      cleanedUp = true;
      void powerPoint.send('cleanup', { root: presentations.root() });
    }
    return operationResult({ available });
  }));

  // The Presentations tab is open: get PowerPoint ready in the background.
  ipcMain.handle('presentations:warm', guard(async () => {
    if (await powerPoint.isAvailable()) powerPoint.warm();
    return operationResult(true);
  }));

  // Cards PowerPoint could not read when they were added (it was busy): try again in the
  // background whenever the library is shown, and refresh the cards once it worked.
  // While PowerPoint stays busy it is asked again every few seconds (for about two minutes), so
  // the cards fill in by themselves once the teacher answers PowerPoint's question.
  const repairing = new Set();
  let repairTimer = null;
  let repairRetries = 0;
  function repairPictures(items) {
    if (playing) return;
    for (const item of items) {
      if (!presentations.needsPicture(item) || editing.has(item.id) || repairing.has(item.id)) continue;
      repairing.add(item.id);
      void presentations.refreshThumbnail(item.id)
        .then((updated) => {
          if (updated && !updated.error) {
            repairRetries = 0;
            notifyChanged();
          } else if (updated?.error === 'POWERPOINT_BUSY') {
            retryRepairLater();
          }
        })
        .catch(() => undefined)
        .finally(() => repairing.delete(item.id));
    }
  }
  function retryRepairLater() {
    if (repairTimer || repairRetries >= 24) return;
    repairRetries++;
    repairTimer = setTimeout(async () => {
      repairTimer = null;
      repairPictures(await presentations.list().catch(() => []));
    }, 5000);
  }

  ipcMain.handle('presentations:list', guard(async () => {
    const items = await presentations.list();
    repairRetries = 0;
    repairPictures(items);
    return operationResult({ items, editing: [...editing] });
  }));

  // The teacher finished editing and wants to play it here: close it in PowerPoint (only when
  // saved; otherwise PowerPoint comes to the front with PRESENTATION_UNSAVED).
  ipcMain.handle('presentations:release', guard(async ({ id }) => {
    const filePath = await presentations.filePath(id);
    if (!filePath) return operationError('PRESENTATION_MISSING', 'Not found.');
    const result = await powerPoint.send('release', { path: filePath });
    if (!result.ok) return operationError(result.error || 'PRESENTATION_FAILED', result.error);
    if (editing.delete(id)) await presentations.refreshThumbnail(id);
    notifyChanged();
    return operationResult(true);
  }));

  ipcMain.handle('presentations:import', guard(async () => {
    const win = getMainWindow();
    const picked = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PowerPoint', extensions: presentations.PRESENTATION_EXTENSIONS.map((ext) => ext.slice(1)) }]
    });
    if (picked.canceled || !picked.filePaths.length) return operationResult({ added: [], failed: [], canceled: true });
    return operationResult(await presentations.importFiles(picked.filePaths));
  }));

  ipcMain.handle('presentations:create-blank', guard(async ({ title }) => {
    const created = await presentations.createBlank(title);
    if (!created.ok) return operationError(created.error || 'PRESENTATION_FAILED', created.error);
    editing.add(created.item.id);
    watchEditing();
    return operationResult({ item: created.item });
  }));

  ipcMain.handle('presentations:rename', guard(async ({ id, title }) => operationResult({ item: await presentations.rename(id, title) })));

  ipcMain.handle('presentations:delete', guard(async ({ id }) => {
    if (editing.has(id)) return operationError('PRESENTATION_EDITING', 'It is open in PowerPoint.');
    return operationResult({ removed: await presentations.remove(id) });
  }));

  ipcMain.handle('presentations:thumbnail', guard(async ({ id }) => operationResult({ dataUrl: await presentations.thumbnailDataUrl(id) })));

  ipcMain.handle('presentations:edit', guard(async ({ id }) => {
    const filePath = await presentations.filePath(id);
    if (!filePath) return operationError('PRESENTATION_MISSING', 'Not found.');
    await stop();
    const result = await powerPoint.send('edit', { path: filePath });
    if (!result.ok) return operationError(result.error || 'PRESENTATION_FAILED', result.error);
    editing.add(id);
    watchEditing();
    return operationResult({ editing: true });
  }));

  ipcMain.handle('presentations:play', guard(async ({ id, rect, slide }) => {
    const win = getMainWindow();
    const filePath = await presentations.filePath(id);
    if (!win || win.isDestroyed() || !filePath) return operationError('PRESENTATION_MISSING', 'Not found.');
    if (editing.has(id)) return operationError('PRESENTATION_EDITING', 'It is open in PowerPoint.');
    stageRect = rect;
    followWindow(win);
    const owner = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
    const result = await powerPoint.send('play', { path: filePath, owner, slide: slide || 1, root: presentations.root(), ...screenRect() });
    if (!result.ok) {
      stageRect = null;
      return operationError(result.error || 'PRESENTATION_FAILED', result.error);
    }
    playing = true;
    playingId = id;
    follow();
    // The slideshow never takes the keyboard (see the helper), but PowerPoint was in front while
    // it opened: give No-Prep the keyboard back.
    if (!win.isDestroyed()) win.focus();    // the page may have moved while PowerPoint was opening the file
    return operationResult({ slides: result.slides, slide: result.slide });
  }));

  ipcMain.handle('presentations:move', guard(async ({ rect }) => {
    stageRect = rect;
    follow();
    return operationResult(true);
  }));

  const POINTER_TOOLS = ['arrow', 'pen', 'laser', 'eraser', 'clear'];
  ipcMain.handle('presentations:command', guard(async ({ command, slide, tool }) => {
    if (!['next', 'prev', 'goto', 'hide', 'show', 'pointer'].includes(command)) return operationError('BAD_COMMAND', command);
    if (command === 'pointer' && !POINTER_TOOLS.includes(tool)) return operationError('BAD_COMMAND', tool);
    const result = await powerPoint.send(command, { slide, tool });
    return result.ok ? operationResult(true) : operationError('PRESENTATION_FAILED', result.error);
  }));

  ipcMain.handle('presentations:state', guard(async () => {
    if (!playing) return operationResult({ running: false });
    // The player decides when the show has ended (it asks twice); this stays "playing" until it
    // stops, so one odd answer never leaves the slideshow without its window following.
    const result = await powerPoint.send('state');
    return operationResult({ running: !!result.running, slide: result.slide, slides: result.slides });
  }));

  ipcMain.handle('presentations:snapshot', guard(async ({ width }) => {
    const out = path.join(app.getPath('temp'), 'noprep-slide-snapshot.png');
    const result = await powerPoint.send('snapshot', { out, width: Math.min(2400, Math.max(320, Number(width) || 1280)) });
    if (!result.ok) return operationResult({ dataUrl: null });
    const bytes = await fsp.readFile(out);
    return operationResult({ dataUrl: `data:image/png;base64,${bytes.toString('base64')}` });
  }));

  // A few slide pictures at a time (from..to): the player asks batch by batch and shows them as
  // they come, and a "stop" (leaving the page) never waits behind a long run of pictures.
  ipcMain.handle('presentations:slide-pictures', guard(async ({ from, to }) => {
    if (!playing || !playingId) return operationResult({ slides: 0, pictures: [] });
    const dir = presentations.slidesDir(playingId);
    const first = Math.max(1, Number(from) || 1);
    const result = await powerPoint.send('slides', { dir, width: 320, from: first, to: Math.max(first, Number(to) || first) });
    if (!result.ok) return operationResult({ slides: 0, pictures: [] });
    const last = Math.min(result.slides, Math.max(first, Number(to) || first));
    const pictures = [];
    for (let i = first; i <= last; i++) {
      try {
        const bytes = await fsp.readFile(path.join(dir, `${i}.png`));
        pictures.push(`data:image/png;base64,${bytes.toString('base64')}`);
      } catch {
        pictures.push(null);
      }
    }
    return operationResult({ slides: result.slides, pictures });
  }));

  ipcMain.handle('presentations:stop', guard(async () => {
    await stop();
    return operationResult(true);
  }));

  return { stop, isPlaying: () => playing };
}

module.exports = { registerPresentationIpc };
