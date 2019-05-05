import React from 'react';
import { graphql } from 'gatsby';
import Layout from '../components/Layout';
import PhotoGrid from '../components/PhotoGrid';
import Pagination from '../components/Pagination';

export default ({ data, pageContext }) => (
  <Layout
    title={
      pageContext.page === 1
        ? `Galeri Foto`
        : `Galeri Foto - Halaman ${pageContext.page}`
    }
    slug={pageContext.page === 1 ? '' : pageContext.slug}
    mainClassName="container--large"
  >
    <PhotoGrid items={data.allMarkdownRemark.nodes} />
    <Pagination {...pageContext} />
  </Layout>
);

export const query = graphql`
  query($skip: Int!, $limit: Int!) {
    allMarkdownRemark(
      sort: { fields: frontmatter___date, order: DESC }
      filter: { frontmatter: { type: { eq: "photo" } } }
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
          image {
            childImageSharp {
              fluid(
                maxWidth: 300
                maxHeight: 300
                cropFocus: CENTER
                quality: 70
                srcSetBreakpoints: [575]
              ) {
                ...GatsbyImageSharpFluid_tracedSVG
              }
            }
          }
        }
      }
    }
  }
`;
