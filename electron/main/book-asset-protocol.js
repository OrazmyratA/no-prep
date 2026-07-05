function createBookAssetProtocol({
  fs,
  path,
  net,
  pathToFileURL,
  getRegistryPath,
  normalizeBookRelativePath,
  protocol
}) {
  function encodeBookAssetUrl(bookId, relativePath) {
    const encodedPath = String(relativePath || '')
      .split(/[\\/]+/)
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `noprep-book://${encodeURIComponent(String(bookId || ''))}/${encodedPath}`;
  }

  function findBookSync(bookId) {
    try {
      const registryPath = getRegistryPath();
      const content = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : '[]';
      const registry = JSON.parse(content);
      return Array.isArray(registry)
        ? registry.find((item) => item.id === String(bookId || '')) || null
        : null;
    } catch {
      return null;
    }
  }

  function resolveBookAssetPath(bookId, relativePath) {
    const book = findBookSync(bookId);
    if (!book) {
      return null;
    }

    const normalizedPath = normalizeBookRelativePath(relativePath);
    if (!normalizedPath) {
      return null;
    }

    const resolved = path.resolve(book.folderPath, normalizedPath);
    const root = path.resolve(book.folderPath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }

    try {
      const realRoot = fs.realpathSync.native(root);
      const realResolved = fs.realpathSync.native(resolved);
      const realRelative = path.relative(realRoot, realResolved);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        return null;
      }
      return realResolved;
    } catch {
      return null;
    }
  }

  function registerBookAssetProtocol() {
    protocol.handle('noprep-book', (request) => {
      try {
        const parsed = new URL(request.url);
        const bookId = decodeURIComponent(parsed.hostname);
        const relativePath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
        const resolved = resolveBookAssetPath(bookId, relativePath);
        if (!resolved) {
          return new Response('Book asset not found', { status: 404 });
        }
        return net.fetch(pathToFileURL(resolved).toString());
      } catch {
        return new Response('Invalid book asset URL', { status: 400 });
      }
    });
  }

  return {
    encodeBookAssetUrl,
    resolveBookAssetPath,
    registerBookAssetProtocol
  };
}

module.exports = {
  createBookAssetProtocol
};
