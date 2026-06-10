/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                'sans': ['Inter', 'sans-serif'],
                'bebas': ['Inter', 'sans-serif'],
                'bebas-real': ['"Bebas Neue"', 'sans-serif'],
                'oswald': ['Inter', 'sans-serif'],
            },
            colors: {
                bg: 'var(--bg)',
                fg: 'var(--fg)',
                sidebar: 'var(--sidebar-bg)',
                card: 'var(--card-bg)',
                chip: 'var(--chip-bg)',
                'chip-active': 'var(--chip-bg-active)',
                border: 'var(--border)',
                primary: '#6a43ff', // Deep violet — main action color
                'primary-soft': '#8b7cff',
                accent: '#ec007d', // Arma2 magenta — accents/highlights only
                'surface-0': '#0c0a1d',
                'surface-1': '#141029',
                'surface-2': '#1d1740',
                'surface-3': '#272050',
                success: 'var(--btn-success)',
                warning: 'var(--btn-warning)',
                danger: 'var(--btn-danger)',
                muted: 'var(--muted)',
                // FIFA Theme Colors
                'fifa-primary': 'rgb(229, 119, 175)',
                'fifa-accent': '#DE1C49',
                'fifa-dark': '#232a32',
                'fifa-gray': '#b2b2af',
                'fifa-cyan': '#0EA9C6',
            },
            backgroundImage: {
                'fifa-gradient': 'linear-gradient(135deg, #24c6dc 10%, #514a9d 100%)',
                'auth-gradient': 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)',
                'app-gradient': 'linear-gradient(170deg, #141129 0%, #1d1742 46%, #161232 76%, #100d22 100%)',
                'cta-gradient': 'linear-gradient(135deg, #8b5cff 0%, #6a43ff 52%, #5430e0 100%)',
                'surface-gradient': 'linear-gradient(165deg, rgba(48,38,98,0.72), rgba(20,16,41,0.94))',
                'accent-gradient': 'linear-gradient(135deg, #ec007d 0%, #b1338f 100%)',
                'icon-tile-gradient': 'linear-gradient(140deg, rgba(139,92,255,0.32), rgba(106,67,255,0.12))',
            },
            boxShadow: {
                'fifa-card': '0 2px 18px 0 rgb(34 40 80 / 10%)',
                'elev-1': '0 4px 14px rgba(5, 3, 16, 0.4)',
                'elev-2': '0 12px 32px rgba(5, 3, 16, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
                'elev-3': '0 24px 64px rgba(5, 3, 16, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.07)',
                'glow-violet': '0 0 20px rgba(122, 82, 255, 0.4)',
                'glow-accent': '0 0 14px rgba(236, 0, 125, 0.45)',
                'cta': '0 8px 24px rgba(106, 67, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.22)',
            },
            borderRadius: {
                '4xl': '32px',
                'card': '18px',
                'pill': '999px',
            },
            keyframes: {
                'pulse-zoom': {
                    '0%, 100%': { transform: 'scale(1)' },
                    '50%': { transform: 'scale(1.1)' },
                }
            },
            animation: {
                'pulse-zoom': 'pulse-zoom 2s ease-in-out infinite',
            }
        },
    },
    plugins: [],
}
