import { FilesService } from './files.service';

describe('FilesService.shownAs', () => {
  it('shows the kinds a tab shows as themselves, by their bare type', () => {
    expect(FilesService.shownAs('application/pdf')).toBe('application/pdf');
    expect(FilesService.shownAs('image/png')).toBe('image/png');
    expect(FilesService.shownAs('IMAGE/JPEG')).toBe('image/jpeg');
    expect(FilesService.shownAs('text/plain; charset=utf-8')).toBe('text/plain');
    expect(FilesService.shownAs('audio/mpeg')).toBe('audio/mpeg');
    expect(FilesService.shownAs('video/mp4')).toBe('video/mp4');
  });

  it('saves, never shows, a file a browser would run as this app', () => {
    for (const type of [
      'text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml',
      'application/xml', 'application/javascript', 'text/javascript',
      'application/octet-stream', '', 'text/html; charset=utf-8',
      'image/svg+xml; charset=utf-8',
    ]) {
      expect(FilesService.shownAs(type)).withContext(type).toBe('');
    }
  });
});
