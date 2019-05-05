import React from 'react';
import { graphql } from 'gatsby';
import Layout from '../components/Layout';
import PostList from '../components/PostList';
import Pagination from '../components/Pagination';

export default ({ data, pageContext }) => (
  <Layout
    title={
      pageContext.page === 1
        ? `Blog Risan Bagja`
        : `Blog Risan Bagja - Halaman ${pageContext.page}`
    }
    slug={pageContext.page === 1 ? '' : pageContext.slug}
    disableTitleTemplate
  >
    <PostList items={data.allMarkdownRemark.nodes} />
    <Pagination {...pageContext} />
  </Layout>
);

export const query = graphql`
  query($skip: Int!, $limit: Int!) {
    allMarkdownRemark(
      sort: { fields: frontmatter___date, order: DESC }
      skip: $skip
      limit: $limit
    ) {
      nodes {
        fields {
          slug
        }
        frontmatter {
          title
          date
          tags
          image {
            childImageSharp {
              fluid(
                maxWidth: 300
                maxHeight: 180
                cropFocus: CENTER
                quality: 70
                srcSetBreakpoints: [575]
              ) {
                ...GatsbyImageSharpFluid_tracedSVG
              }
            }
          }
        }
        excerpt
        timeToRead
      }
    }
  }
`;
