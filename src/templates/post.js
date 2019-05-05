import React, { useState } from 'react';
import { graphql } from 'gatsby';
import Layout from '../components/Layout';
import Disqus from '../components/Disqus';
import { formatDate } from '../utils/helpers';
import styles from './post.module.scss';

export default ({ data, location }) => {
  const { post, site } = data;

  const [commentsVisibility, setCommentsVisibility] = useState(false);

  return (
    <Layout
      title={post.frontmatter.title}
      description={post.excerpt}
      image={
        post.frontmatter.image
          ? post.frontmatter.image.childImageSharp.resize
          : null
      }
      slug={post.fields.slug}
    >
      <article>
        <h1>{post.frontmatter.title}</h1>
        <p className={styles.info}>
          <span>{formatDate(post.frontmatter.date)}</span>
          <span>&middot;</span>
          <span>{post.timeToRead} min read</span>
        </p>
        <div dangerouslySetInnerHTML={{ __html: post.html }} />

        {post.frontmatter.tags && (
          <p className={styles.tags}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
            >
              <path d="M0 0h24v24H0z" fill="none" />
              <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" />
            </svg>
            {post.frontmatter.tags.map(tag => (
              <span key={tag}>#{tag}</span>
            ))}
          </p>
        )}
      </article>

      {post.fields.comments && (
        <section className={styles.comments}>
          {commentsVisibility ? (
            <>
              <h3>Comments</h3>
              <Disqus
                shortname={site.siteMetadata.disqusShortname}
                pageSlug={post.fields.slug}
                pageTitle={post.frontmatter.title}
                pageUrl={location.href}
              />
            </>
          ) : (
            <button
              type="button"
              className="button"
              onClick={() => setCommentsVisibility(true)}
            >
              Load Comments
            </button>
          )}
        </section>
      )}
    </Layout>
  );
};

export const query = graphql`
  query($slug: String!) {
    post: markdownRemark(fields: { slug: { eq: $slug } }) {
      fields {
        comments
        slug
      }
      frontmatter {
        title
        date
        tags
        image {
          childImageSharp {
            resize(width: 1200, cropFocus: CENTER) {
              src
              width
              height
            }
          }
        }
      }
      timeToRead
      html
      excerpt
    }
    site {
      siteMetadata {
        disqusShortname
      }
    }
  }
`;
