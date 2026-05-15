/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-bs-theme="dark"]'],
  content: ['./views/**/*.ejs', './public/js/**/*.js', './src/http/controllers/**/*.js'],
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#f8f9fc',
          100: '#eef2ff',
          900: '#0f172a',
        },
        brand: {
          500: '#4f46e5',
          600: '#4338ca',
        },
      },
      borderRadius: {
        app: '14px',
      },
      boxShadow: {
        card: '0 10px 28px rgba(43, 45, 66, 0.06)',
        lift: '0 18px 44px rgba(43, 45, 66, 0.10)',
      },
    },
  },
  plugins: [],
};
