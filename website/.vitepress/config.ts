import { defineConfig } from 'vitepress';

const SITE_ORIGIN = 'https://opencoworkai.github.io';
const SITE_BASE = '/open-cowork/';
const SITE_URL = `${SITE_ORIGIN}${SITE_BASE}`;
const OG_IMAGE = `${SITE_URL}og-image.png`;

export default defineConfig({
  title: 'Open Cowork',
  description:
    'Open-source AI agent desktop app for Windows & macOS — one-click install Claude Code, MCP tools, and Skills with sandbox isolation and multi-model support.',

  base: SITE_BASE,

  head: [
    ['link', { rel: 'icon', href: '/open-cowork/logo.png' }],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Open Cowork — Open-Source AI Agent Desktop App' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Free, open-source AI agent desktop app for Windows & macOS. One-click install with sandbox isolation, multi-model support, and built-in Skills.',
      },
    ],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Open Cowork — Open-Source AI Agent Desktop App' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Free AI agent desktop app for Windows & macOS. One-click install, multi-model, sandbox isolation.',
      },
    ],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
    // SEO
    [
      'meta',
      {
        name: 'keywords',
        content:
          'Open Cowork, AI agent, desktop app, Claude Code, MCP, Skills, sandbox, open source, Windows, macOS, multi-model, PPTX generator, Feishu, Slack',
      },
    ],
    // Schema.org JSON-LD
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Open Cowork',
        description:
          'Open-source AI agent desktop app for Windows and macOS with one-click installation, sandbox isolation, and multi-model support.',
        url: SITE_URL,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Windows, macOS',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://opensource.org/licenses/MIT',
        softwareVersion: '3.3.0',
        author: {
          '@type': 'Organization',
          name: 'OpenCoworkAI',
          url: 'https://github.com/OpenCoworkAI',
        },
      }),
    ],
  ],

  sitemap: { hostname: SITE_URL },

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Download', link: 'https://github.com/OpenCoworkAI/open-cowork/releases' },
      { text: 'GitHub', link: 'https://github.com/OpenCoworkAI/open-cowork' },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/OpenCoworkAI/open-cowork' },
      { icon: 'discord', link: 'https://discord.gg/pynjtQDf' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2025-present OpenCoworkAI',
    },

    search: { provider: 'local' },
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      description: '免费开源的 AI 智能助手桌面应用，支持 Windows 和 macOS 一键安装。',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '下载', link: 'https://github.com/OpenCoworkAI/open-cowork/releases' },
          { text: 'GitHub', link: 'https://github.com/OpenCoworkAI/open-cowork' },
        ],
        footer: {
          message: '基于 MIT 协议开源。',
          copyright: '© 2025-present OpenCoworkAI',
        },
      },
    },
  },
});
