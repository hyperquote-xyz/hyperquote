import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: {
    default: 'HyperQuote Docs',
    template: '%s | HyperQuote Docs',
  },
  description:
    'Documentation for HyperQuote — institutional-grade RFQ trading on HyperEVM',
}

const banner = (
  <Banner storageKey="hyperquote-live-banner">
    HyperQuote is live on HyperEVM —{' '}
    <a href="https://hyperquote.xyz/swap" target="_blank" rel="noopener">
      Start trading &rarr;
    </a>
  </Banner>
)

const logo = (
  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>
      <span style={{ color: '#2DD4BF' }}>Hyper</span>Quote
    </span>
    <span
      style={{
        opacity: 0.35,
        fontWeight: 400,
        fontSize: '0.85rem',
        marginLeft: '4px',
      }}
    >
      Docs
    </span>
  </span>
)

const navbar = (
  <Navbar
    logo={logo}
    projectLink="https://github.com/hyperquote"
  />
)

const footer = (
  <Footer>
    <span>
      &copy; {new Date().getFullYear()} HyperQuote. All rights reserved.
    </span>
  </Footer>
)

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning className="dark">
      <Head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#2DD4BF" />
      </Head>
      <body>
        <Layout
          banner={banner}
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/hyperquote/hyperquote-v3/tree/main/apps/docs"
          footer={footer}
          sidebar={{ defaultMenuCollapseLevel: 1, toggleButton: true }}
          toc={{ backToTop: true }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
