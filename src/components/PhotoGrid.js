import React from 'react';
import PropTypes from 'prop-types';
import PhotoGridItem from './PhotoGridItem';
import styles from './PhotoGrid.module.scss';

const PhotoGrid = ({ items }) => (
  <section className={styles.wrapper}>
    {items.map(({ fields, frontmatter }) => (
      <PhotoGridItem
        key={fields.slug}
        slug={fields.slug}
        title={frontmatter.title}
        date={frontmatter.date}
        image={frontmatter.image.childImageSharp.fluid}
      />
    ))}
  </section>
);

PhotoGrid.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      fields: PropTypes.object.isRequired,
      frontmatter: PropTypes.object.isRequired,
    })
  ).isRequired,
};

export default PhotoGrid;
