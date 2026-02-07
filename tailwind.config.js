/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: "#0EA5E9",
                "primary-hover": "#0284C7",
            }
        },
    },
    plugins: [
        require('daisyui'),
    ],
    daisyui: {
        themes: [
            {
                light: {
                    ...require("daisyui/src/theming/themes")["light"],
                    primary: "#0EA5E9",
                    "primary-content": "#FFFFFF",
                    secondary: "#F1F5F9",
                    "secondary-content": "#64748B",
                    accent: "#50E3C2",
                    "base-100": "#FFFFFF",
                    "base-200": "#F8FAFC",
                    "base-300": "#F1F5F9",
                },
            },
        ],
    },
}
