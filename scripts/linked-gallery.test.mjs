import test from 'node:test';
import assert from 'node:assert/strict';
import { rehypeFigure } from '../src/lib/rehype-figure.mjs';

const image = (src) => ({ type: 'element', tagName: 'img', properties: { src, alt: 'A family outing' }, children: [] });
const paragraph = (child) => ({ type: 'element', tagName: 'p', properties: {}, children: [child] });
const link = (href, child) => ({ type: 'element', tagName: 'a', properties: { href }, children: [child] });

test('linked previews retain their full images, order, and hidden gallery membership', async () => {
  const tree = { type: 'root', children: [
    paragraph(link('/photos/first.webp', image('/photos/thumb-first.webp'))),
    paragraph(link('/photos/second.webp', image('/photos/thumb-second.webp'))),
  ] };
  await rehypeFigure({ defaultLimit: 1 })(tree, {});
  const gallery = tree.children[0];
  assert.equal(gallery.properties.dataCount, '2');
  assert.deepEqual(gallery.children.map((figure) => figure.properties.dataFullSrc), ['/photos/first.webp', '/photos/second.webp']);
  assert.equal(gallery.children[0].children[0].properties.src, '/photos/thumb-first.webp');
  assert.ok(gallery.children[1].properties.className.includes('hidden-gallery-item'));
});

test('ordinary images keep existing behavior and links to pages remain links', async () => {
  const pageLink = link('/family/', image('/photos/preview.webp'));
  const tree = { type: 'root', children: [paragraph(image('/photos/ordinary.webp')), paragraph(pageLink)] };
  await rehypeFigure()(tree, {});
  assert.equal(tree.children[0].tagName, 'figure');
  assert.equal(tree.children[0].properties.dataFullSrc, undefined);
  assert.equal(tree.children[1].tagName, 'p');
  assert.equal(tree.children[1].children[0], pageLink);
});

test('compact galleries use three short desktop rows and square phone tiles without reordering', async () => {
  const sources = Array.from({ length: 32 }, (_, i) => `/photos/${i + 1}.webp`);
  const gallery = { type: 'element', tagName: 'div', properties: {
    className: ['media-gallery'], dataLayout: 'compact', dataLimit: '8',
  }, children: sources.map((src) => paragraph(link(src, image('/photos/happy-birthday-baby/thumb-01-dscf6808.webp')))) };
  const tree = { type: 'root', children: [gallery] };
  await rehypeFigure()(tree, { path: 'content/happy-birthday-baby/index.md' });
  const figures = gallery.children;
  assert.equal(gallery.properties.dataCount, '32');
  assert.deepEqual(figures.map((figure) => figure.properties.dataFullSrc), sources);
  assert.equal(figures.filter((figure) => !figure.properties.className.includes('hidden-gallery-item')).length, 8);
  assert.match(figures[0].properties.style, /--c: 2;.*--a: 4\/5/);
  assert.match(figures[3].properties.style, /--c: 2;.*--a: 4\/5/);
  assert.match(figures[6].properties.style, /--c: 3;.*--a: 3\/2/);
  assert.match(figures[0].properties.style, /--ma: 1\/1/);
  assert.equal(figures[7].children.at(-1).children[0].children[0].value, '+24');
});

 test('compact previews give landscape photos a wider cell beside a portrait', async () => {
  const gallery = { type: 'element', tagName: 'div', properties: {
    className: ['media-gallery'], dataLayout: 'compact', dataLimit: '8',
  }, children: ['01-dscf6808', '02-img-7325', '03-img-5515', '04-dscf4149', '05-dscf2059', '06-img-7341', '07-img-5249', '08-dscf3137'].map((name) => paragraph(image(`/photos/happy-birthday-baby/thumb-${name}.webp`))) };
  await rehypeFigure()({ type: 'root', children: [gallery] }, { path: 'content/happy-birthday-baby/index.md' });
  assert.match(gallery.children[4].properties.style, /--c: 4;.*--a: 16\/9/);
  assert.match(gallery.children[3].properties.style, /--c: 2/);
  assert.match(gallery.children[5].properties.style, /--c: 2;.*--a: 4\/5/);
});
