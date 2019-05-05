import React from 'react';
import { Link } from 'gatsby';
import SiteMetadata from './SiteMetadata';

export default ({ children, className, mainClassName = '', ...props }) => (
  <div className={className}>
    <SiteMetadata {...props} />

    <header className="header">
      <div className="container">
        <Link to="/" className="header__title">
          Risan Bagja
        </Link>
        <nav className="nav">
          <ul className="nav__menu">
            <li>
              <Link to="/photos/">Galeri</Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>

    <main className={`main container ${mainClassName}`.trim()}>{children}</main>

    <footer className="footer container">
      <nav>
        <ul className="footer__links">
          <li>
            <a href="https://risanb.com">Programming Blog</a>
          </li>
          <li>
            <a href="/rss.xml">RSS</a>
          </li>
        </ul>
      </nav>
    </footer>
  </div>
);
