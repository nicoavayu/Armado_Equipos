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
                primary: '#ec007d', // Arma2 brand magenta
                'primary-bright': '#ff1e94',
                'primary-deep': '#c40068',
                'brand-deep': '#271232',
                'brand-violet': '#7b2ff7',
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
                'app-gradient': 'linear-gradient(160deg, #1b0c26 0%, #271232 42%, #1d0e2c 74%, #120818 100%)',
                'cta-gradient': 'linear-gradient(180deg, #ff1e94 0%, #ec007d 55%, #d4006f 100%)',
            },
            boxShadow: {
                'fifa-card': '0 2px 18px 0 rgb(34 40 80 / 10%)',
                'glow-magenta': '0 0 18px rgba(236, 0, 125, 0.35)',
                'glow-magenta-soft': '0 4px 14px rgba(236, 0, 125, 0.25)',
                'card-premium': '0 18px 40px rgba(8, 3, 16, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
            },
            borderRadius: {
                '4xl': '32px',
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
