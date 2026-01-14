/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm cream/beige theme inspired by Claude Cowork
        background: {
          DEFAULT: '#f5f3ee',
          secondary: '#faf9f6',
          grid: '#e8e6e1',
        },
        surface: {
          DEFAULT: '#ffffff',
          hover: '#faf9f6',
          active: '#f0eeea',
          muted: '#f7f6f3',
        },
        border: {
          DEFAULT: '#e5e3de',
          muted: '#ebe9e4',
        },
        accent: {
          DEFAULT: '#c45a35',
          light: '#e8d5c4',
          hover: '#b54e2a',
          muted: '#f5ebe3',
        },
        text: {
          primary: '#1a1a1a',
          secondary: '#5c5c5c',
          muted: '#8c8c8c',
        },
        success: '#2d8a4e',
        warning: '#c9a227',
        error: '#c43535',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0, 0, 0, 0.04)',
        'card': '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)',
        'elevated': '0 4px 12px rgba(0, 0, 0, 0.08)',
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      backgroundImage: {
        'grid-pattern': `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4d2cc' fill-opacity='0.4'%3E%3Cpath d='M0 0h1v40H0V0zm39 0h1v40h-1V0z'/%3E%3Cpath d='M0 0h40v1H0V0zm0 39h40v1H0v-1z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
