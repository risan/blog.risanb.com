import React from 'react';
import PropTypes from 'prop-types';
import PostListItem from './PostListItem';

const PostList = ({ items }) => (
  <div>
    {items.map(({ excerpt, fields, frontmatter, timeToRead }) => (
      <PostListItem
        key={fields.slug}
        slug={fields.slug}
        title={frontmatter.title}
        excerpt={excerpt}
        date={frontmatter.date}
        tags={frontmatter.tags}
        image={frontmatter.image.childImageSharp.fluid}
        timeToRead={timeToRead}
      />
    ))}
  </div>
);

PostList.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      fields: PropTypes.object.isRequired,
      frontmatter: PropTypes.object.isRequired,
      excerpt: PropTypes.string.isRequired,
      timeToRead: PropTypes.number,
    })
  ).isRequired,
};

export default PostList;
