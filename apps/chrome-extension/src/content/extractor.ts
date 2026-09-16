import { Readability } from '@mozilla/readability';
import { normalizeWhitespace } from '@second-brain/shared';

/**
 * Readability wrapper.
 *
 * The extension never uploads raw DOM: extraction happens in the content script, in the
 * page's own process, and only the resulting text leaves the page. Cloning first is not
 * optional — Readability mutates the document it is handed, and handing it the live
 * `document` breaks the page under the user.
 *
 * Phase 1a scope: extraction is implemented and tested here, but the page-view tracker does
 * not call it yet. `page_read` events, with their content hash and word count, ship with the
 * document path in Phase 2.
 */

/** Minimum extracted text length before a page counts as readable content. */
export const READABILITY_MIN_CHARACTERS = 500;

/** Normalized Readability output; a subset of `Document` from `@second-brain/shared`. */
export interface ExtractedDocument {
  title: string;
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  excerpt: string | null;
  textContent: string;
  /** Character count of `textContent` before any server-side normalization. */
  length: number;
  /** BCP-47 tag detected by Readability; null when it could not decide. */
  language: string | null;
}

/** Parsing options handed to Readability; the character floor mirrors the server's. */
export const READABILITY_OPTIONS = {
  charThreshold: READABILITY_MIN_CHARACTERS,
  keepClasses: false,
  disableJSONLD: false,
} as const;

/** Nodes that carry no readable content and can only confuse the extractor. */
const STRIPPED_SELECTORS: readonly string[] = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'form',
  'input',
  'select',
  'textarea',
  'button',
];

/**
 * Returns a detached copy of `doc` with script, style, noscript, and form controls
 * removed, safe to hand to Readability and safe to discard afterwards.
 *
 * A `<base>` element carrying the page's own base URI is inserted into the copy: the clone
 * is not the page, so the browser no longer resolves relative `href`/`src` attributes
 * against the page origin for it, and without the base every relative link in the extracted
 * content would come out unresolved.
 */
export function cloneForExtraction(doc: Document): Document {
  const clone = doc.cloneNode(true) as Document;

  for (const selector of STRIPPED_SELECTORS) {
    for (const node of Array.from(clone.querySelectorAll(selector))) {
      node.remove();
    }
  }

  const head = clone.querySelector('head');
  if (head !== null && clone.querySelector('base') === null && doc.baseURI) {
    const base = clone.createElement('base');
    base.setAttribute('href', doc.baseURI);
    head.insertBefore(base, head.firstChild);
  }

  return clone;
}

/**
 * Extracts the readable body of a document, or null when the page has less than
 * {@link READABILITY_MIN_CHARACTERS} of text — an app shell, a login wall, or a gallery.
 */
export function extractReadableDocument(doc: Document): ExtractedDocument | null {
  const article = new Readability(cloneForExtraction(doc), READABILITY_OPTIONS).parse();
  if (article === null) {
    return null;
  }

  const textContent = normalizeWhitespace(article.textContent ?? '');
  if (textContent.length < READABILITY_MIN_CHARACTERS) {
    return null;
  }

  const title = normalizeWhitespace(article.title ?? '') || normalizeWhitespace(doc.title);

  return {
    title,
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    publishedTime: article.publishedTime ?? null,
    excerpt: article.excerpt ?? null,
    textContent,
    length: textContent.length,
    language: article.lang ?? null,
  };
}

/** True when extraction produced enough text to be worth a `page_read` event. */
export function hasEnoughContent(extracted: ExtractedDocument | null): boolean {
  return extracted !== null && extracted.length >= READABILITY_MIN_CHARACTERS;
}
