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
