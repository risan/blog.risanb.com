module.exports = {
  siteMetadata: {
    title: 'Risan Bagja',
    description: 'Kumpulan catatan harian Risan Bagja Pradana',
    siteUrl: 'https://blog.risanb.com',
    lang: 'id',
    locale: 'id_ID',
    twitter: '@risanbagja',
    disqusShortname: 'risanblog',
  },
  plugins: [
    {
      resolve: 'gatsby-plugin-feed',
      options: {
        query: `
          {
            site {
              siteMetadata {
                title
                description
                site_url: siteUrl
              }
            }
          }
        `,
        feeds: [
          {
            serialize: ({ query }) => query.allMarkdownRemark.nodes.map(node => ({
              ...node.frontmatter,
              description: node.excerpt,
              url: query.site.siteMetadata.site_url + node.fields.slug,
              guid: query.site.siteMetadata.site_url + node.fields.slug,
              custom_elements: [{ "content:encoded": node.html }],
            })),
            query: `
              {
                allMarkdownRemark(
                  sort: { order: DESC, fields: [frontmatter___date] },
                ) {
                  nodes {
                    html
                    excerpt
                    fields {
                      slug
                    }
                    frontmatter {
                      title
                      date
                    }
                  }
                }
              }
            `,
            output: '/rss.xml',
            title: 'blog.risanb.com RSS Feed',
          },
        ],
      },
    },
    {
      resolve: 'gatsby-plugin-google-analytics',
      options: {
        trackingId: 'UA-27136969-16',
        anonymize: true,
        respectDNT: true,
      },
    },
    {
      resolve: 'gatsby-plugin-manifest',
      options: {
        name: 'Blog Risan Bagja',
        short_name: 'blog.risanb.com',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#212529',
        display: 'minimal-ui',
        icon: 'content/img/pencil.png',
      },
    },
    {
      resolve: 'gatsby-plugin-sass',
      options: {
        implementation: require('sass'),
      },
    },
    'gatsby-plugin-sharp',
    'gatsby-plugin-sitemap',
    'gatsby-plugin-react-helmet',
    {
      resolve: 'gatsby-source-filesystem',
      options: {
        name: 'src',
        path: `${__dirname}/src/`,
      },
    },
    {
      resolve: 'gatsby-source-filesystem',
      options: {
        name: 'content',
        path: `${__dirname}/content/`,
      },
    },
    {
      resolve: 'gatsby-transformer-remark',
      options: {
        plugins: [
          {
            resolve: 'gatsby-remark-images',
            options: {
              maxWidth: 656,
              showCaptions: true,
              tracedSVG: true,
            },
          },
        ],
      },
    },
    'gatsby-transformer-sharp',
  ],
}
