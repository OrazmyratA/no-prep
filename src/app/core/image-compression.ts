// browser-image-compression compresses in a Web Worker, but by default that worker downloads the
// library from cdn.jsdelivr.net. The desktop app's security policy blocked that (every picture
// was then compressed on the main thread, freezing weak PCs for a moment), and it failed offline
// or on school networks that block the CDN. The app ships its own copy (angular.json assets →
// assets/vendor), and every compression points the worker at it.

/** Absolute URL of the app's copy of the library, for the `libURL` option. */
export function imageCompressionLibUrl(): string {
  return new URL('assets/vendor/browser-image-compression.js', document.baseURI).href;
}
