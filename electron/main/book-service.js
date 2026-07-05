const { createBookAssetService } = require('./book-asset-service');

function createBookService({
  fs,
  fsp,
  path,
  nativeImage,
  pathExists,
  getDirectorySize,
  createId,
  upsertRegistryItem,
  constants
}) {
  const {
    normalizeBookRelativePath,
    collectRelativeAssetReferences,
    collectBookPages,
    collectBookAssetReferences,
    collectPageAssetPrefixes,
    pruneUnusedBookAssets,
    rewriteRelativeAssetPaths
  } = createBookAssetService({ fsp, path, pathExists });

  async function scanPdfProtectionAndPages(pdfPath) {
    return new Promise((resolve, reject) => {
      let count = 0;
      let encrypted = false;
      let carry = '';
      const stream = fs.createReadStream(pdfPath, { encoding: 'latin1' });
      stream.on('data', (chunk) => {
        const text = carry + chunk;
        if (text.includes('/Encrypt')) {
          encrypted = true;
        }
        const matches = text.match(/\/Type\s*\/Page\b/g);
        if (matches) {
          count += matches.length;
        }
        carry = text.slice(-32);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve({ encrypted, pageCount: Math.max(1, count) }));
    });
  }

  async function getPdfInfo(pdfPath) {
    const scan = await scanPdfProtectionAndPages(pdfPath);
    if (scan.encrypted) {
      return { encrypted: true, pageCount: scan.pageCount };
    }

    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({ url: pdfPath, disableWorker: true }).promise;
      return { encrypted: false, pageCount: Math.max(1, doc.numPages) };
    } catch (error) {
      if (String(error?.name || '').includes('Password') || String(error?.message || '').toLowerCase().includes('password')) {
        return { encrypted: true, pageCount: scan.pageCount };
      }
      console.warn('PDF.js page count failed, falling back to stream scan:', error);
      return scan;
    }
  }

  async function generateFirstPageCover(pdfPath, bookFolder) {
    try {
      if (!nativeImage?.createThumbnailFromPath) {
        return '';
      }

      const thumbnail = await nativeImage.createThumbnailFromPath(pdfPath, { width: 420, height: 560 });
      if (!thumbnail || thumbnail.isEmpty()) {
        return '';
      }

      const coverPath = path.join(bookFolder, 'cover.png');
      await fsp.writeFile(coverPath, thumbnail.toPNG());
      return 'cover.png';
    } catch (error) {
      console.warn('Book first-page cover generation failed:', error?.message || error);
      return '';
    }
  }

  async function readBookJson(folderPath) {
    const jsonPath = path.join(folderPath, constants.BOOK_JSON_FILE);
    const content = await fsp.readFile(jsonPath, 'utf8');
    return JSON.parse(content);
  }

  async function writeBookJson(folderPath, book) {
    await fsp.writeFile(path.join(folderPath, constants.BOOK_JSON_FILE), JSON.stringify(book, null, 2), 'utf8');
  }

  function createBlankBookPage() {
    return {
      id: createId('page'),
      type: 'blank',
      backgroundColor: '#ffffff',
      elements: []
    };
  }

  function createPdfPages(pageCount, sourcePdf, idPrefix = 'page') {
    return Array.from({ length: pageCount }, (_unused, index) => ({
      id: createId(idPrefix),
      type: 'pdf',
      pdfPage: index + 1,
      sourcePdf,
      elements: []
    }));
  }

  async function listBookPdfAssets(folderPath) {
    const assetsRoot = path.join(folderPath, 'assets');
    if (!(await pathExists(assetsRoot))) {
      return [];
    }

    const pdfs = [];
    async function walk(dirPath, relativeBase) {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        const relativePath = path.posix.join(relativeBase, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath, relativePath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
          pdfs.push(path.posix.join('assets', relativePath));
        }
      }
    }

    await walk(assetsRoot, '');
    return pdfs.sort((a, b) => {
      const aSource = path.posix.basename(a).toLowerCase() === 'source.pdf' ? 0 : 1;
      const bSource = path.posix.basename(b).toLowerCase() === 'source.pdf' ? 0 : 1;
      return aSource - bSource || a.localeCompare(b);
    });
  }

  async function repairMissingPageSourcePdfs(book, folderPath) {
    if (!book || !Array.isArray(book.pages)) {
      return false;
    }

    const sourcePdf = normalizeBookRelativePath(book.sourcePdf);
    if (sourcePdf && (await pathExists(path.join(folderPath, sourcePdf)))) {
      return false;
    }

    const missingPdfPages = book.pages.filter((page) => page?.type === 'pdf' && !page.sourcePdf);
    if (!missingPdfPages.length) {
      return false;
    }

    const availablePdfs = await listBookPdfAssets(folderPath);
    if (!availablePdfs.length) {
      return false;
    }

    if (availablePdfs.length === 1) {
      for (const page of missingPdfPages) {
        page.sourcePdf = availablePdfs[0];
      }
      return true;
    }

    const segments = [];
    let currentSegment = null;
    let lastPdfPage = 0;
    for (const [index, page] of book.pages.entries()) {
      if (page?.type !== 'pdf' || page.sourcePdf) {
        continue;
      }

      const pdfPage = Number(page.pdfPage || 0);
      if (!currentSegment || (lastPdfPage > 0 && pdfPage > 0 && pdfPage <= lastPdfPage)) {
        currentSegment = { indexes: [], hints: new Set() };
        segments.push(currentSegment);
      }

      currentSegment.indexes.push(index);
      for (const hint of collectPageAssetPrefixes(page)) {
        currentSegment.hints.add(hint);
      }
      if (pdfPage > 0) {
        lastPdfPage = pdfPage;
      }
    }

    const used = new Set();
    let changed = false;
    for (const segment of segments) {
      const hints = Array.from(segment.hints);
      let candidates = hints.length
        ? availablePdfs.filter((pdf) => hints.some((hint) => pdf.startsWith(`${hint}/`)))
        : availablePdfs;

      if (!candidates.length) {
        candidates = availablePdfs;
      }

      const unusedCandidates = candidates.filter((pdf) => !used.has(pdf));
      if (unusedCandidates.length) {
        candidates = unusedCandidates;
      }

      const chosen = candidates.find((pdf) => path.posix.basename(pdf).toLowerCase() === 'source.pdf') || candidates[0];
      if (!chosen) {
        continue;
      }

      used.add(chosen);
      for (const index of segment.indexes) {
        book.pages[index].sourcePdf = chosen;
        changed = true;
      }
    }

    return changed;
  }

  async function repairBookData(book, folderPath) {
    let changed = false;
    if (await repairMissingPageSourcePdfs(book, folderPath)) {
      changed = true;
    }
    return changed;
  }

  async function validateBookFolder(folderPath, options = {}) {
    const label = options.label || 'This book';
    const jsonPath = path.join(folderPath, constants.BOOK_JSON_FILE);
    if (!(await pathExists(jsonPath))) {
      throw new Error(`${label} does not contain ${constants.BOOK_JSON_FILE}.`);
    }

    let book;
    try {
      book = await readBookJson(folderPath);
    } catch {
      throw new Error(`${label} has a broken ${constants.BOOK_JSON_FILE}.`);
    }

    return validateBookData(book, folderPath, label, options);
  }

  async function validateBookData(book, folderPath, label = 'This book', options = {}) {
    if (!book || typeof book !== 'object') {
      throw new Error(`${label} is not a valid book.`);
    }
    if (!Array.isArray(book.pages)) {
      throw new Error(`${label} does not have a valid pages list.`);
    }
    if (book.pages.length < 1) {
      throw new Error(`${label} must contain at least one page.`);
    }

    if (options.repair !== false && await repairBookData(book, folderPath)) {
      await writeBookJson(folderPath, book);
    }

    const allPages = collectBookPages(book);
    const pdfPages = allPages.filter((page) => page?.type === 'pdf');
    const sourcePdf = normalizeBookRelativePath(book.sourcePdf);
    if (sourcePdf && !(await pathExists(path.join(folderPath, sourcePdf)))) {
      throw new Error(`${label} is missing source PDF: ${sourcePdf}.`);
    }
    if (Array.isArray(book.workbooks)) {
      for (const workbook of book.workbooks) {
        const workbookSourcePdf = normalizeBookRelativePath(workbook?.sourcePdf);
        if (workbookSourcePdf && !(await pathExists(path.join(folderPath, workbookSourcePdf)))) {
          throw new Error(`${label} is missing workbook PDF: ${workbookSourcePdf}.`);
        }
      }
    }
    for (const page of pdfPages) {
      const pageSourcePdf = normalizeBookRelativePath(page.sourcePdf || sourcePdf);
      if (!pageSourcePdf) {
        throw new Error(`${label} has PDF pages but no sourcePdf path.`);
      }
      if (!(await pathExists(path.join(folderPath, pageSourcePdf)))) {
        throw new Error(`${label} is missing source PDF: ${pageSourcePdf}.`);
      }
    }

    const cover = normalizeBookRelativePath(book.cover);
    if (cover && !(await pathExists(path.join(folderPath, cover)))) {
      throw new Error(`${label} is missing cover file: ${cover}.`);
    }

    const references = collectRelativeAssetReferences(allPages);
    for (const relativePath of references) {
      if (!(await pathExists(path.join(folderPath, relativePath)))) {
        throw new Error(`${label} is missing asset: ${relativePath}.`);
      }
    }

    return { book, references: Array.from(references) };
  }

  async function readBookAnnotations(folderPath, bookId) {
    const annotationsPath = path.join(folderPath, constants.BOOK_ANNOTATIONS_FILE);
    try {
      const content = await fsp.readFile(annotationsPath, 'utf8');
      const annotations = JSON.parse(content);
      return {
        version: '1.0',
        bookId,
        pages: annotations && typeof annotations.pages === 'object' ? annotations.pages : {},
        updatedAt: annotations.updatedAt || new Date().toISOString()
      };
    } catch {
      return {
        version: '1.0',
        bookId,
        pages: {},
        updatedAt: new Date().toISOString()
      };
    }
  }

  async function writeBookAnnotations(folderPath, annotations, bookId) {
    const safeAnnotations = {
      version: '1.0',
      bookId,
      pages: annotations && typeof annotations.pages === 'object' ? annotations.pages : {},
      updatedAt: new Date().toISOString()
    };
    await fsp.writeFile(
      path.join(folderPath, constants.BOOK_ANNOTATIONS_FILE),
      JSON.stringify(safeAnnotations, null, 2),
      'utf8'
    );
  }

  function makeRegistryItem(book, folderPath, sizeBytes) {
    return {
      id: book.id,
      title: book.title || 'Untitled Book',
      folderPath,
      coverPath: book.cover,
      pageCount: Array.isArray(book.pages) ? book.pages.length : 0,
      sizeBytes,
      createdAt: book.createdAt || new Date().toISOString(),
      updatedAt: book.updatedAt || new Date().toISOString()
    };
  }

  function getCachedSizeBytes(registryItem) {
    const size = Number(registryItem?.sizeBytes);
    return Number.isFinite(size) && size >= 0 ? size : null;
  }

  function hasRemovedBookAssetReferences(previousBook, nextBook) {
    const previousReferences = collectBookAssetReferences(previousBook);
    const nextReferences = collectBookAssetReferences(nextBook);
    for (const reference of previousReferences) {
      if (!nextReferences.has(reference)) {
        return true;
      }
    }
    return false;
  }

  async function updateRegistrySizeByDelta(registryItem, deltaBytes) {
    const current = await readBookJson(registryItem.folderPath);
    const cachedSize = getCachedSizeBytes(registryItem);
    const delta = Number(deltaBytes) || 0;
    const sizeBytes = cachedSize === null
      ? await getDirectorySize(registryItem.folderPath)
      : Math.max(0, cachedSize + delta);
    await upsertRegistryItem(makeRegistryItem(current, registryItem.folderPath, sizeBytes));
  }

  async function repairBookRegistryItems(items) {
    let changed = false;
    const repaired = [];

    for (const item of items) {
      let next = item;
      try {
        if (!item?.folderPath || !(await pathExists(path.join(item.folderPath, constants.BOOK_JSON_FILE)))) {
          repaired.push(item);
          continue;
        }

        const book = await readBookJson(item.folderPath);
        const bookChanged = await repairBookData(book, item.folderPath);
        let coverChanged = false;
        let cover = normalizeBookRelativePath(book.cover);
        const hasCover = cover && (await pathExists(path.join(item.folderPath, cover)));

        if (!hasCover) {
          const firstPdfPage = Array.isArray(book.pages)
            ? book.pages.find((page) => page?.type === 'pdf')
            : null;
          const sourcePdf = normalizeBookRelativePath(firstPdfPage?.sourcePdf || book.sourcePdf);
          if (sourcePdf && (await pathExists(path.join(item.folderPath, sourcePdf)))) {
            cover = await generateFirstPageCover(path.join(item.folderPath, sourcePdf), item.folderPath);
            if (cover) {
              book.cover = cover;
              coverChanged = true;
            }
          }
        }

        if (bookChanged || coverChanged) {
          await writeBookJson(item.folderPath, book);
        }

        const pageCount = Array.isArray(book.pages) ? book.pages.length : item.pageCount || 0;
        next = {
          ...item,
          id: book.id || item.id,
          title: book.title || item.title || 'Untitled Book',
          coverPath: cover || undefined,
          pageCount,
          createdAt: book.createdAt || item.createdAt || new Date().toISOString(),
          updatedAt: book.updatedAt || item.updatedAt || new Date().toISOString()
        };

        if (
          next.id !== item.id ||
          next.title !== item.title ||
          next.coverPath !== item.coverPath ||
          next.pageCount !== item.pageCount ||
          next.createdAt !== item.createdAt ||
          next.updatedAt !== item.updatedAt
        ) {
          changed = true;
        }
      } catch (error) {
        console.warn('Book registry repair skipped:', item?.title || item?.id, error?.message || error);
      }

      repaired.push(next);
    }

    return { items: repaired, changed };
  }

  return {
    getPdfInfo,
    generateFirstPageCover,
    readBookJson,
    writeBookJson,
    createBlankBookPage,
    createPdfPages,
    normalizeBookRelativePath,
    collectBookAssetReferences,
    pruneUnusedBookAssets,
    validateBookFolder,
    validateBookData,
    readBookAnnotations,
    writeBookAnnotations,
    makeRegistryItem,
    getCachedSizeBytes,
    hasRemovedBookAssetReferences,
    updateRegistrySizeByDelta,
    repairBookRegistryItems,
    rewriteRelativeAssetPaths
  };
}

module.exports = { createBookService };
