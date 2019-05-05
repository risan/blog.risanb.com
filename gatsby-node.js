const path = require('path');
const { createFilePath } = require('gatsby-source-filesystem');
const _ = require('lodash');
const { siteMetadata } = require('./gatsby-config');

exports.onCreateNode = ({ node, getNode, actions }) => {
  const { createNodeField } = actions;

  if (node.internal.type === 'MarkdownRemark') {
    createNodeField({
      node,
      name: 'slug',
      value: createFilePath({ node, getNode }),
    });

    createNodeField({
      node,
      name: 'comments',
      value: _.has(siteMetadata, 'disqusShortname')
        && _.get(node, 'frontmatter.comments', true),
    });
  }
};

const createIndexPages = ({ createPage, posts }) => {
   const perPage = 20;
   const totalPages = Math.ceil(posts.length / perPage);
   const component = path.resolve('./src/templates/index.js');

   const pathForPage = i => i === 1 ? '/' : `/page/${i}/`;

  _.range(1, totalPages + 1).forEach(i => createPage({
     path: pathForPage(i),
     component,
     context: {
       limit: perPage,
       skip: (i - 1) * perPage,
       slug: pathForPage(i),
       page: i,
       prevPage: i === 1 ? null : pathForPage(i - 1),
       nextPage: i === totalPages ? null : pathForPage(i + 1),
     },
   }));
};

const createPhotoPages = ({ createPage, posts }) => {
  const photoPosts = posts.filter(post => post.frontmatter.type === 'photo');

   const perPage = 24;
   const totalPages = Math.ceil(photoPosts.length / perPage);
   const component = path.resolve('./src/templates/photos.js');

   const pathForPage = i => i === 1 ? '/photos/' : `/photos/page/${i}/`;

  _.range(1, totalPages + 1).forEach(i => createPage({
     path: pathForPage(i),
     component,
     context: {
       limit: perPage,
       skip: (i - 1) * perPage,
       slug: pathForPage(i),
       page: i,
       prevPage: i === 1 ? null : pathForPage(i - 1),
       nextPage: i === totalPages ? null : pathForPage(i + 1),
     },
   }));
};

exports.createPages = async ({ graphql, actions }) => {
  const { data } = await graphql(`
    {
      allMarkdownRemark {
        nodes {
          fields {
            slug
          }
          frontmatter {
            type
          }
        }
      }
    }
  `);

  const { createPage } = actions;
  const posts = data.allMarkdownRemark.nodes;

  const postTemplate = path.resolve('./src/templates/post.js');

  posts.forEach(post => {
    createPage({
      path: post.fields.slug,
      component: postTemplate,
      context: {
        slug: post.fields.slug,
      },
    });
  });

  createIndexPages({ createPage, posts });
  createPhotoPages({ createPage, posts });
};
