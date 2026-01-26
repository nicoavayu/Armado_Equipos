/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                'bebas': ['"Bebas Neue"', 'sans-serif'],
                'oswald': ['Oswald', 'sans-serif'],
            },
            colors: {
                bg: 'var(--bg)',
                fg: 'var(--fg)',
                sidebar: 'var(--sidebar-bg)',
                card: 'var(--card-bg)',
                chip: 'var(--chip-bg)',
                'chip-active': 'var(--chip-bg-active)',
                border: 'var(--border)',
                primary: '#8178e5', // Updated to match auth button
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
                'app-gradient': 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
            },
            boxShadow: {
                'fifa-card': '0 2px 18px 0 rgb(34 40 80 / 10%)',
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
