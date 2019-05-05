import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'gatsby';
import Img from 'gatsby-image';
import { formatDate } from '../utils/helpers';
import styles from './PostListItem.module.scss';

const PostListItem = ({
  date,
  excerpt,
  image,
  slug,
  tags,
  timeToRead,
  title,
}) => (
  <article className={styles.item}>
    <Link to={slug} className={styles.image}>
      <Img fluid={image} />
    </Link>
    <div>
      <h3 className={styles.title}>
        <Link to={slug}>{title}</Link>
      </h3>
      <p className={styles.info}>
        <span>{formatDate(date)}</span>
        <span>&middot;</span>
        <span>{timeToRead} min read</span>
      </p>
      <p className={styles.excerpt}>{excerpt}</p>
      {tags && (
        <p className={styles.tags}>
          {tags.map(tag => (
            <span key={tag}>#{tag}</span>
          ))}
        </p>
      )}
    </div>
  </article>
);

PostListItem.propTypes = {
  date: PropTypes.string.isRequired,
  excerpt: PropTypes.string.isRequired,
  image: PropTypes.object.isRequired,
  slug: PropTypes.string.isRequired,
  tags: PropTypes.array,
  timeToRead: PropTypes.number.isRequired,
  title: PropTypes.string.isRequired,
};

export default PostListItem;
