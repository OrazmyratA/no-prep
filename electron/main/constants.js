const BOOKS_DIR_NAME = 'Books';
const BOOK_REGISTRY_FILE = 'book-registry.json';
const BOOK_JSON_FILE = 'book.json';
const BOOK_ANNOTATIONS_FILE = 'student-annotations.json';
const BOOK_PACKAGE_EXTENSION = '.noprepbook';
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_RECORDING_BYTES = 100 * 1024 * 1024;
const MAX_TOPIC_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200000;
const ZIP_IFMT = 0o170000;
const ZIP_IFLNK = 0o120000;
// The NoPrep AI proxy (ai-proxy/, a Cloudflare Worker). Empty = "NoPrep AI" is not offered and
// teachers use their own AI keys. Set it to the URL printed by `npm run deploy` in ai-proxy/.
// NOPREP_AI_PROXY_URL overrides it for local testing (e.g. `npx wrangler dev`).
const AI_PROXY_URL = process.env.NOPREP_AI_PROXY_URL || '';

module.exports = {
  AI_PROXY_URL,
  BOOKS_DIR_NAME,
  BOOK_REGISTRY_FILE,
  BOOK_JSON_FILE,
  BOOK_ANNOTATIONS_FILE,
  BOOK_PACKAGE_EXTENSION,
  MAX_INLINE_IMAGE_BYTES,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_TOPIC_SNAPSHOT_BYTES,
  MAX_ZIP_ENTRIES,
  ZIP_IFMT,
  ZIP_IFLNK
};
