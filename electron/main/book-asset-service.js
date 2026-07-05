function createBookAssetService({
  fsp,
  path,
  pathExists
}) {
  function normalizeBookRelativePath(relativePath) {
    const raw = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!raw || raw.includes('\0')) {
      return '';
    }
    const normalized = path.posix.normalize(raw);
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') {
      return '';
    }
    return normalized;
  }

  function collectRelativeAssetReferences(value, references = new Set()) {
    if (typeof value === 'string') {
      const normalized = normalizeBookRelativePath(value);
      if (normalized.startsWith('assets/')) {
        references.add(normalized);
      }
      return references;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectRelativeAssetReferences(item, references);
      }
      return references;
    }

    if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) {
        collectRelativeAssetReferences(nested, references);
      }
    }
    return references;
  }

  function collectBookPages(book) {
    const pages = Array.isArray(book?.pages) ? [...book.pages] : [];
    const workbooks = Array.isArray(book?.workbooks) ? book.workbooks : [];
    for (const workbook of workbooks) {
      if (Array.isArray(workbook?.pages)) {
        pages.push(...workbook.pages);
      }
    }
    return pages;
  }

  function collectBookAssetReferences(book) {
    const references = collectRelativeAssetReferences(book);
    const sourcePdf = normalizeBookRelativePath(book?.sourcePdf);
    const cover = normalizeBookRelativePath(book?.cover);
    if (sourcePdf && sourcePdf.startsWith('assets/')) references.add(sourcePdf);
    if (cover && cover.startsWith('assets/')) references.add(cover);
    if (Array.isArray(book?.workbooks)) {
      for (const workbook of book.workbooks) {
        const workbookSourcePdf = normalizeBookRelativePath(workbook?.sourcePdf);
        if (workbookSourcePdf && workbookSourcePdf.startsWith('assets/')) references.add(workbookSourcePdf);
      }
    }
    for (const page of collectBookPages(book)) {
      const pageSourcePdf = normalizeBookRelativePath(page?.sourcePdf);
      if (pageSourcePdf && pageSourcePdf.startsWith('assets/')) references.add(pageSourcePdf);
    }
    return references;
  }

  function collectPageAssetPrefixes(page) {
    const references = Array.from(collectRelativeAssetReferences(page?.elements || []));
    return references
      .map((reference) => reference.split('/').slice(0, -1).join('/'))
      .filter(Boolean);
  }

  async function listAssetFiles(folderPath) {
    const assetsRoot = path.join(folderPath, 'assets');
    if (!(await pathExists(assetsRoot))) return [];
    const files = [];
    async function walk(dirPath, relativeBase) {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        const relativePath = path.posix.join('assets', relativeBase, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath, path.posix.join(relativeBase, entry.name));
        } else if (entry.isFile()) {
          files.push({ absolutePath: entryPath, relativePath });
        }
      }
    }
    await walk(assetsRoot, '');
    return files;
  }

  async function removeEmptyAssetFolders(folderPath) {
    const assetsRoot = path.join(folderPath, 'assets');
    if (!(await pathExists(assetsRoot))) return;
    async function walk(dirPath) {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(dirPath, entry.name));
        }
      }
      if (dirPath !== assetsRoot) {
        const remaining = await fsp.readdir(dirPath);
        if (remaining.length === 0) {
          await fsp.rmdir(dirPath).catch(() => {});
        }
      }
    }
    await walk(assetsRoot);
  }

  async function pruneUnusedBookAssets(book, folderPath) {
    const references = collectBookAssetReferences(book);
    const files = await listAssetFiles(folderPath);
    for (const file of files) {
      if (references.has(file.relativePath)) continue;
      await fsp.rm(file.absolutePath, { force: true }).catch(() => {});
    }
    await removeEmptyAssetFolders(folderPath);
  }

  function rewriteRelativeAssetPaths(value, assetPrefix) {
    if (typeof value === 'string') {
      return value.startsWith('assets/') ? `assets/${assetPrefix}/${value.slice('assets/'.length)}` : value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => rewriteRelativeAssetPaths(item, assetPrefix));
    }
    if (value && typeof value === 'object') {
      const next = {};
      for (const [key, nested] of Object.entries(value)) {
        next[key] = rewriteRelativeAssetPaths(nested, assetPrefix);
      }
      return next;
    }
    return value;
  }

  return {
    normalizeBookRelativePath,
    collectRelativeAssetReferences,
    collectBookPages,
    collectBookAssetReferences,
    collectPageAssetPrefixes,
    pruneUnusedBookAssets,
    rewriteRelativeAssetPaths
  };
}

module.exports = { createBookAssetService };
