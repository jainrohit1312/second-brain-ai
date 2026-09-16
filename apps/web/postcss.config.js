/**
 * PostCSS pipeline for apps/web. Loaded as CommonJS alongside `next.config.js`.
 *
 * `tailwindcss` first, so `autoprefixer` sees the fully expanded utility CSS.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
