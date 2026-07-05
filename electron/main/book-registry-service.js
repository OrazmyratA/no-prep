function createBookRegistryService({
  fsp,
  path,
  pathExists,
  getBooksRoot,
  getRegistryPath
}) {
  async function ensureBooksRoot() {
    await fsp.mkdir(getBooksRoot(), { recursive: true });
  }

  async function readRegistry() {
    await ensureBooksRoot();
    const registryPath = getRegistryPath();
    if (!(await pathExists(registryPath))) {
      return [];
    }

    try {
      const content = await fsp.readFile(registryPath, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeRegistry(items) {
    await ensureBooksRoot();
    const registryPath = getRegistryPath();
    await fsp.mkdir(path.dirname(registryPath), { recursive: true });
    await fsp.writeFile(registryPath, JSON.stringify(Array.isArray(items) ? items : [], null, 2), 'utf8');
  }

  async function upsertRegistryItem(item) {
    const registry = await readRegistry();
    const index = registry.findIndex((entry) => entry?.id === item?.id);
    if (index >= 0) {
      registry[index] = item;
    } else {
      registry.push(item);
    }
    await writeRegistry(registry);
    return item;
  }

  async function removeRegistryItem(bookId) {
    const registry = await readRegistry();
    const next = registry.filter((entry) => entry?.id !== bookId);
    await writeRegistry(next);
    return next;
  }

  return {
    readRegistry,
    writeRegistry,
    upsertRegistryItem,
    removeRegistryItem
  };
}

module.exports = { createBookRegistryService };
