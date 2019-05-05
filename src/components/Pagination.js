import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'gatsby';

import './Pagination.scss';

const Pagination = ({ prevPage, nextPage }) =>
  prevPage || nextPage ? (
    <nav className="pagination">
      {prevPage && (
        <Link to={prevPage} className="button">
          &larr; Newer Posts
        </Link>
      )}
      {nextPage && (
        <Link to={nextPage} className="button button--next">
          Older Posts &rarr;
        </Link>
      )}
    </nav>
  ) : null;

Pagination.propTypes = {
  prevPage: PropTypes.string,
  nextPage: PropTypes.string,
};

export default Pagination;
