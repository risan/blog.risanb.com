import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'gatsby';
import Img from 'gatsby-image';
import { formatDate } from '../utils/helpers';
import styles from './PhotoGridItem.module.scss';

const PhotoGridItem = ({ date, image, slug, title }) => (
  <article className={styles.item}>
    <Link to={slug} className={styles.link}>
      <Img fluid={image} />
      <div className={styles.description}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.info}>{formatDate(date)}</p>
      </div>
    </Link>
  </article>
);

PhotoGridItem.propTypes = {
  date: PropTypes.string.isRequired,
  image: PropTypes.object.isRequired,
  slug: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
};

export default PhotoGridItem;
