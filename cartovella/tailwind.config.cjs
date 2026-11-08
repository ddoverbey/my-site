module.exports = {
  content: ['./index.html', './*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        cinzel: ['"Cinzel"', 'serif'],
        cinzelDeco: ['"Cinzel Decorative"', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif']
      },
      colors: {
        parchment: '#dfd2b5',
        parchmentDark: '#121624',
        parchmentBorder: '#2e3b5e',
        arcane: '#38bdf8',
        gold: '#fbbf24',
        goldGlow: '#f59e0b',
        fogDark: '#05070d',
        emeraldExp: '#10b981'
      }
    }
  }
};
