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
                'surface-0': '#110e24',
                'surface-1': '#181334',
                'surface-2': '#201a44',
                'surface-3': '#2a2256',
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
                'cta-gradient': 'linear-gradient(180deg, #7b56ff 0%, #6a43ff 58%, #5b36e6 100%)',
                'surface-gradient': 'linear-gradient(168deg, rgba(42, 34, 86, 0.66), rgba(24, 19, 52, 0.92))',
            },
            boxShadow: {
                'fifa-card': '0 2px 18px 0 rgb(34 40 80 / 10%)',
                'elev-1': '0 4px 14px rgba(6, 4, 18, 0.35)',
                'elev-2': '0 10px 28px rgba(6, 4, 18, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                'elev-3': '0 22px 56px rgba(6, 4, 18, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
                'glow-violet': '0 0 16px rgba(106, 67, 255, 0.35)',
                'glow-accent': '0 0 12px rgba(236, 0, 125, 0.4)',
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
