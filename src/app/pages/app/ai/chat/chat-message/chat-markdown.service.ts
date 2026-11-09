import { Injectable, SecurityContext, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MarkdownService, ParseOptions } from 'ngx-markdown';
import { EngineService } from 'src/app/services/engine.service';

/**
 * Markdown as a chat message shows it: nothing in it is fetched from
 * somewhere else, and nothing of the engine's is fetched without the
 * session.
 *
 * What a message says may come from a web page, a document or a tool an
 * agent read — text nobody here wrote. A picture in it is requested the
 * moment it is drawn, with no click, and its address can carry whatever
 * the text around it was told to put there. So a message shows inline
 * only two kinds of picture:
 *
 *   - one written out in the message itself, as `data:image/…`;
 *   - a file of the engine's own (its download route), which is marked
 *     with FILE and fetched with the session's token by the chat message
 *     (an `<img>` carries no token, and the engine is on another origin).
 *
 * Every other picture, video or sound becomes a link the person may
 * choose to follow, showing its description or its address. A link to
 * an engine file is marked the same way, so following it fetches the
 * file with the session rather than arriving at the engine without one.
 * An address of the old one-origin install, `/download/…` on this page's
 * origin, is read as the engine's: it named the same file.
 *
 * Words in angle brackets that name no HTML element (`<date>`, `<name>`)
 * are what a person or a model wrote, not markup: they are kept as text,
 * where the sanitizer would have taken them out and the words with them.
 *
 * The chat message provides this in place of the app's MarkdownService,
 * so only messages are rendered this way. It sanitizes the HTML itself,
 * as the app's markdown is set to, then works on it in a document that
 * loads nothing.
 */
@Injectable()
export class ChatMarkdownService extends MarkdownService {
  /** The attribute that names an engine file on a picture or a link. */
  static readonly FILE = 'data-engine-file';

  private readonly domSanitizer = inject(DomSanitizer);

  override async parse(markdown: string, parseOptions?: ParseOptions): Promise<string> {
    const html = ChatMarkdownService.wordsKept(await super.parse(markdown, { ...parseOptions, disableSanitizer: true }));
    const safe = parseOptions?.disableSanitizer ? html : this.domSanitizer.sanitize(SecurityContext.HTML, html) ?? '';
    return ChatMarkdownService.withoutRemoteMedia(safe);
  }

  /** The same HTML with every tag that names no HTML element written out
   *  as text. Code is already text here: marked escapes it. */
  static wordsKept(html: string): string {
    return html.replace(/<\/?([A-Za-z][\w-]*)\b[^<>]*>/g, (tag, name: string) =>
      !name.includes('-') && !(document.createElement(name) instanceof HTMLUnknownElement)
        ? tag : tag.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  }

  /** The same HTML with everything that would load from elsewhere
   *  taken out, and the engine's files marked to be fetched. */
  static withoutRemoteMedia(html: string): string {
    if (!html || !/<(img|picture|source|video|audio|track|a)\b/i.test(html)) return html;
    const page = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const FILE = ChatMarkdownService.FILE;
    const linked = (address: string, words: string): HTMLElement => {
      const link = page.createElement('a');
      link.setAttribute('href', address);
      const file = ChatMarkdownService.engineFile(address);
      if (file) link.setAttribute(FILE, file);
      link.textContent = words || (file ? file : address) || 'image';
      return link;
    };
    page.body.querySelectorAll('img').forEach((image) => {
      const address = (image.getAttribute('src') || '').trim();
      // A list of candidate addresses is a second way to name a picture
      // elsewhere; a chat message has no use for one.
      image.removeAttribute('srcset');
      if (/^data:image\//i.test(address)) return;
      const file = ChatMarkdownService.engineFile(address);
      if (file) {
        // Nothing is asked for until the chat fetches it with the token.
        image.removeAttribute('src');
        image.setAttribute(FILE, file);
        return;
      }
      image.replaceWith(linked(address, image.getAttribute('alt') || ''));
    });
    page.body.querySelectorAll('video, audio').forEach((media) => {
      const addresses = [
        media.getAttribute('src') || '', media.getAttribute('poster') || '',
        ...Array.from(media.querySelectorAll('source, track'))
          .map((source) => source.getAttribute('src') || ''),
      ].map((value) => value.trim()).filter(Boolean);
      const chosen = addresses.find((value) => ChatMarkdownService.engineFile(value))
        || addresses.find((value) => /^https?:/i.test(value));
      if (chosen) media.replaceWith(linked(chosen, ''));
      else media.remove();
    });
    // A picture's alternatives, and any source left outside a player.
    page.body.querySelectorAll('source, track').forEach((source) => source.remove());
    page.body.querySelectorAll('a[href]').forEach((link) => {
      const file = ChatMarkdownService.engineFile(link.getAttribute('href') || '');
      if (file) link.setAttribute(FILE, file);
    });
    return page.body.innerHTML;
  }

  /**
   * The engine file an address names — its reference on the engine's
   * download route — or ''. The engine's own address, path included,
   * or `/download/…` on this page's origin (the old one-origin install);
   * nothing with a further path, a credential, or another scheme.
   */
  static engineFile(address: string): string {
    const value = String(address || '').trim();
    if (!value) return '';
    let at: URL;
    try {
      at = new URL(value, document.baseURI);
    } catch {
      return '';
    }
    if ((at.protocol !== 'http:' && at.protocol !== 'https:') || at.username || at.password) {
      return '';
    }
    const where = at.origin + at.pathname;
    for (const prefix of [`${EngineService.address}/download/`, `${window.location.origin}/download/`]) {
      if (!where.startsWith(prefix)) continue;
      const rest = where.slice(prefix.length);
      if (!rest || rest.includes('/')) return '';
      try {
        return decodeURIComponent(rest);
      } catch {
        return '';
      }
    }
    return '';
  }
}
